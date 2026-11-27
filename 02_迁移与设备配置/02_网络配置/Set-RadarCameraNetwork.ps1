[CmdletBinding()]
param([int]$InterfaceIndex = 0, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Network-Common.ps1')
$backupPath = $null

try {
    if (-not $DryRun) {
        $forwardArguments = @()
        if ($InterfaceIndex -gt 0) { $forwardArguments += @('-InterfaceIndex', [string]$InterfaceIndex) }
        if (Invoke-NetworkElevation -ScriptPath $PSCommandPath -ScriptArguments $forwardArguments) { return }
    }
    $adapter = Select-WiredPhysicalAdapter -InterfaceIndex $InterfaceIndex
    $state = Get-SelectedNetworkState -Adapter $adapter
    Show-SelectedNetworkState -State $state

    $missing = @()
    foreach ($address in @($state.RequestedAddresses)) {
        $elsewhere = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $address -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceIndex -ne $adapter.ifIndex })
        if ($elsewhere.Count -gt 0) { throw ('地址 {0} 已在另一块网卡上，工具停止以免产生冲突。' -f $address) }
        $present = @($state.IPv4Addresses | Where-Object { $_.IPAddress -eq $address })
        if ($present.Count -gt 0) {
            if ([int]$present[0].PrefixLength -ne 24) { throw ('所选网卡上的 {0} 掩码不是 /24，请先人工确认。' -f $address) }
        } else { $missing += $address }
    }
    $state.AddedAddresses = $missing
    Write-Host ''
    Write-Host '计划：仅给上述有线网卡设置以下两个 IPv4 地址，掩码均为 255.255.255.0：' -ForegroundColor Yellow
    Write-Host '  192.168.10.100/24（雷达）；192.168.1.100/24（摄像头）'
    Write-Host '不会主动删除原有地址；不会填入新默认网关或 DNS；不修改其他网卡或 Wi-Fi。'
    Write-Host '添加静态 IPv4 地址会关闭该网卡的 DHCP。Windows 可能移除原来的动态租约地址和动态网关。'
    Write-Host '新电脑后续上网可继续使用 Wi-Fi。若 IP 在局域网内被其他设备占用，请退出并先排除冲突。'
    if ($DryRun) {
        Write-Host 'DryRun：到此为止，只查看计划。未写备份、未改变任何网卡。' -ForegroundColor Green
        return
    }
    if ($missing.Count -eq 0 -and $state.IPv4Interface.Dhcp -eq 'Disabled') {
        Write-Host '所选网卡已具备这两个静态地址；不重复修改、不生成新备份。恢复时请选择最初设置之前的备份。' -ForegroundColor Green
        Show-DeviceConnectivity
        return
    }
    if (@($state.DefaultRoutes).Count -gt 0) {
        Write-Host ''
        Write-Host '注意：选中网卡已有默认网关，可能正在提供上网。这里不主动删除已有网关，但 DHCP 关闭后动态网关可能失效。' -ForegroundColor Yellow
        if ((Read-Host '确认这是接设备交换机的网卡且可改变其 DHCP，输入 KEEP 继续；其他输入取消') -cne 'KEEP') { throw '用户已取消，未修改任何网卡。' }
    }
    if ((Read-Host '确认后输入 APPLY 执行；其他输入取消') -cne 'APPLY') { throw '用户已取消，未修改任何网卡。' }

    $backupFolder = Join-Path $PSScriptRoot 'backups'
    New-Item -ItemType Directory -Path $backupFolder -Force | Out-Null
    $backupName = '{0}_{1}_{2}.json' -f $env:COMPUTERNAME, $state.Adapter.InterfaceGuid, (Get-Date -Format 'yyyyMMdd_HHmmss_fff')
    $backupPath = Join-Path $backupFolder $backupName
    $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $backupPath -Encoding UTF8
    Write-Host ('已备份选中网卡的原配置：{0}' -f $backupPath) -ForegroundColor Green

    Set-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -Dhcp Disabled -ErrorAction Stop
    foreach ($address in $missing) {
        New-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -IPAddress $address -PrefixLength 24 -SkipAsSource $false -ErrorAction Stop | Out-Null
    }
    Write-Host '设置命令已完成。以下显示实际当前状态：' -ForegroundColor Green
    Show-SelectedNetworkState -State (Get-SelectedNetworkState -Adapter $adapter)
    Show-DeviceConnectivity
    Write-Host '如需还原，请使用“03_恢复原网络.cmd”，选择刚才生成的备份。不要把备份拿到其他电脑上恢复。'
} catch {
    Write-Host ('停止：{0}' -f $_.Exception.Message) -ForegroundColor Red
    if (-not [string]::IsNullOrWhiteSpace($backupPath)) {
        Write-Host ('如果已发生部分设置，可用恢复工具还原这个备份：{0}' -f $backupPath) -ForegroundColor Yellow
    }
    exit 1
}
