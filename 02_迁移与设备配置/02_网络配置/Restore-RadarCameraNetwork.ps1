[CmdletBinding()]
param([string]$BackupFile = '', [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Network-Common.ps1')
try {
    if (-not $DryRun) {
        $forwardArguments = @()
        if (-not [string]::IsNullOrWhiteSpace($BackupFile)) {
            if ($BackupFile.Contains('"')) { throw '备份路径不允许包含引号。' }
            $forwardArguments += @('-BackupFile', ('"{0}"' -f $BackupFile))
        }
        if (Invoke-NetworkElevation -ScriptPath $PSCommandPath -ScriptArguments $forwardArguments) { return }
    }
    if ([string]::IsNullOrWhiteSpace($BackupFile)) {
        $backupFolder = Join-Path $PSScriptRoot 'backups'
        $backups = @(Get-ChildItem -LiteralPath $backupFolder -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
        if ($backups.Count -eq 0) { throw '没有本工具生成的备份。请先在这台电脑上运行设置工具。' }
        for ($i = 0; $i -lt $backups.Count; $i++) { Write-Host ('[{0}] {1}' -f ($i + 1), $backups[$i].Name) }
        $answer = Read-Host '输入设置前的备份编号（第一次设置前的备份；不要选其他电脑的备份）'
        $choice = 0
        if (-not [int]::TryParse($answer, [ref]$choice) -or $choice -lt 1 -or $choice -gt $backups.Count) { throw '无效编号，未修改任何网卡。' }
        $BackupFile = $backups[$choice - 1].FullName
    }
    $backup = Get-Content -LiteralPath $BackupFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([int]$backup.SchemaVersion -ne 1) { throw '不支持这个备份格式。' }
    if ([string]$backup.ComputerName -ne $env:COMPUTERNAME) { throw '此备份来自另一台电脑，拒绝恢复。' }
    $guidText = ([guid]$backup.Adapter.InterfaceGuid).ToString('D')
    $matches = @(Get-WiredPhysicalAdapters | Where-Object { ([guid]$_.InterfaceGuid).ToString('D') -eq $guidText })
    if ($matches.Count -ne 1) { throw '没有找到备份中同一 InterfaceGuid 的实体有线网卡。拒绝恢复，不会按旧编号猜测。' }
    if ([string]$backup.IPv4Interface.Dhcp -notin @('Enabled','Disabled')) { throw '备份中的 DHCP 状态无效。' }
    if ([string]$backup.DNS.Mode -notin @('Automatic','Static')) { throw '备份中的 DNS 模式无效。' }
    if ([string]$backup.DNS.Mode -eq 'Static' -and @($backup.DNS.ServerAddresses).Count -eq 0) { throw '备份中的静态 DNS 列表为空。' }
    foreach ($server in @($backup.DNS.ServerAddresses)) {
        $parsedAddress = $null
        if (-not [Net.IPAddress]::TryParse([string]$server, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw '备份含有非 IPv4 DNS 地址，停止恢复。' }
    }
    $adapter = $matches[0]
    Show-SelectedNetworkState -State (Get-SelectedNetworkState -Adapter $adapter)
    Write-Host ''
    Write-Host ('将恢复备份：{0}' -f $BackupFile) -ForegroundColor Yellow
    Write-Host ('原 IPv4 DHCP：{0}；原 DNS 模式：{1}' -f $backup.IPv4Interface.Dhcp, $backup.DNS.Mode)
    Write-Host ('只移除本次原本不存在、由工具新增的地址：{0}' -f (@($backup.AddedAddresses) -join ', '))
    Write-Host '原来已有的地址、其他新加地址和其他网卡不会被主动删除。DHCP 恢复后实际获得的 IP/网关可能与备份不同。'
    if ($DryRun) { Write-Host 'DryRun：未改变任何网卡。' -ForegroundColor Green; return }
    if ((Read-Host '输入 RESTORE 恢复；其他输入取消') -cne 'RESTORE') { throw '用户已取消，未修改任何网卡。' }

    # Only the two known target IPs may be removed, and only if absent before setup.
    foreach ($address in @($backup.AddedAddresses)) {
        if ($address -notin @('192.168.10.100','192.168.1.100')) { throw '备份含有未知的拟移除地址，停止恢复。' }
        if (@($backup.IPv4Addresses | Where-Object { $_.IPAddress -eq $address }).Count -gt 0) { throw '备份不一致：拟移除地址原本就存在。停止恢复。' }
    }
    foreach ($address in @($backup.AddedAddresses)) {
        Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue |
            Remove-NetIPAddress -Confirm:$false -ErrorAction Stop
    }
    if ([string]$backup.IPv4Interface.Dhcp -eq 'Enabled') {
        Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Enabled -ErrorAction Stop
    } elseif ([string]$backup.IPv4Interface.Dhcp -eq 'Disabled') {
        Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled -ErrorAction Stop
        foreach ($original in @($backup.IPv4Addresses | Where-Object { $_.PrefixOrigin -eq 'Manual' })) {
            $current = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress $original.IPAddress -ErrorAction SilentlyContinue)
            if ($current.Count -eq 0) {
                New-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress $original.IPAddress -PrefixLength ([int]$original.PrefixLength) -SkipAsSource ([bool]$original.SkipAsSource) -ErrorAction Stop | Out-Null
            } elseif ([int]$current[0].PrefixLength -ne [int]$original.PrefixLength) { throw '原有静态地址的掩码已经改变，请人工检查，工具不覆盖。' }
        }
        foreach ($route in @($backup.DefaultRoutes | Where-Object { $_.Protocol -ne 'Dhcp' })) {
            $existing = @(Get-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -eq $route.NextHop })
            if ($existing.Count -eq 0) {
                New-NetRoute -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -NextHop $route.NextHop -RouteMetric ([int]$route.RouteMetric) -ErrorAction Stop | Out-Null
            }
        }
    } else { throw '备份中的 DHCP 状态无效。' }
    if ([string]$backup.DNS.Mode -eq 'Automatic') {
        Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
            Set-DnsClientServerAddress -ResetServerAddresses -ErrorAction Stop
    } elseif ([string]$backup.DNS.Mode -eq 'Static' -and @($backup.DNS.ServerAddresses).Count -gt 0) {
        # IPv4 only: do not replace the interface's independently configured IPv6 DNS.
        Get-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop |
            Set-DnsClientServerAddress -ServerAddresses @($backup.DNS.ServerAddresses) -ErrorAction Stop
    } else { throw '备份中的 DNS 配置无效，请人工检查。' }
    Write-Host '恢复命令已完成，以下显示实际状态。DHCP 租约可能需要稍等或重新插拔网线。' -ForegroundColor Green
    Show-SelectedNetworkState -State (Get-SelectedNetworkState -Adapter $adapter)
} catch {
    Write-Host ('恢复停止：{0}' -f $_.Exception.Message) -ForegroundColor Red
    Write-Host '如果已执行一部分恢复，请保留备份并检查网卡状态，不要恢复其他电脑或其他网卡的备份。'
    exit 1
}
