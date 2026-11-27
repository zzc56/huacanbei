# Shared functions for Windows PowerShell 5.1. No network changes on dot-source.
Set-StrictMode -Version 2.0

function Test-NetworkAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Invoke-NetworkElevation {
    param([Parameter(Mandatory=$true)][string]$ScriptPath, [string[]]$ScriptArguments = @())
    if (Test-NetworkAdministrator) { return $false }
    # This is an interactive setup/restore window, so it must remain visible.
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', ('"{0}"' -f $ScriptPath)) + $ScriptArguments
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -Verb RunAs -ErrorAction Stop | Out-Null
    return $true
}

function Get-WiredPhysicalAdapters {
    return @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object {
        $medium = [int]$_.NdisPhysicalMedium
        $looksWired = ($medium -eq 14) -or ([string]$_.MediaType -eq '802.3')
        $looksWireless = $medium -in @(1, 9, 10)
        $looksVirtual = ($_.Name + ' ' + $_.InterfaceDescription) -match '(?i)virtual|vEthernet|Hyper-V|VMware|VirtualBox|Bluetooth|TAP|TUN|WLAN|Wi-?Fi|无线|蓝牙'
        $looksWired -and -not $looksWireless -and -not $looksVirtual
    } | Sort-Object ifIndex)
}

function Select-WiredPhysicalAdapter {
    param([int]$InterfaceIndex = 0)
    $candidates = @(Get-WiredPhysicalAdapters)
    if ($candidates.Count -eq 0) { throw '没有找到实体有线网卡。请接好 USB 网卡或检查驱动；工具不会改 Wi-Fi 或虚拟网卡。' }
    Write-Host ''
    Write-Host '请按网卡名称、型号和连接状态，确认接交换机的实体有线网卡。' -ForegroundColor Cyan
    $candidates | Select-Object @{n='编号';e={$_.ifIndex}}, Name, InterfaceDescription, Status, MacAddress | Format-Table -AutoSize | Out-Host
    if ($InterfaceIndex -eq 0) {
        $answer = Read-Host '输入上表中的网卡编号（输入 Q 退出）'
        if ($answer -match '^[Qq]$') { throw '用户已取消。' }
        $parsed = 0
        if (-not [int]::TryParse($answer, [ref]$parsed)) { throw '编号必须是表中的整数。未修改任何网卡。' }
        $InterfaceIndex = $parsed
    }
    $selected = @($candidates | Where-Object { $_.ifIndex -eq $InterfaceIndex })
    if ($selected.Count -ne 1) { throw '该编号不属于上表中的实体有线网卡。未修改任何网卡。' }
    return $selected[0]
}

function Get-SelectedNetworkState {
    param([Parameter(Mandatory=$true)]$Adapter)
    $index = [int]$Adapter.ifIndex
    $guidText = ([guid]$Adapter.InterfaceGuid).ToString('D')
    $ipInterface = Get-NetIPInterface -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction Stop
    $addresses = @(Get-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{ IPAddress=$_.IPAddress; PrefixLength=[int]$_.PrefixLength; PrefixOrigin=[string]$_.PrefixOrigin; SuffixOrigin=[string]$_.SuffixOrigin; SkipAsSource=[bool]$_.SkipAsSource }
    })
    $routes = @(Get-NetRoute -InterfaceIndex $index -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
        [pscustomobject]@{ DestinationPrefix=$_.DestinationPrefix; NextHop=$_.NextHop; RouteMetric=[int]$_.RouteMetric; Protocol=[string]$_.Protocol }
    })
    $dns = Get-DnsClientServerAddress -InterfaceIndex $index -AddressFamily IPv4 -ErrorAction Stop
    # ServerAddresses alone cannot distinguish DHCP DNS from an explicit DNS list.
    $registryPath = 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{' + $guidText + '}'
    $registryValues = Get-ItemProperty -LiteralPath $registryPath -ErrorAction Stop
    $nameServerProperty = $registryValues.PSObject.Properties['NameServer']
    $staticDnsText = ''
    if ($null -ne $nameServerProperty) { $staticDnsText = [string]$nameServerProperty.Value }
    $dnsMode = 'Automatic'
    if (-not [string]::IsNullOrWhiteSpace($staticDnsText)) { $dnsMode = 'Static' }
    return [pscustomobject]@{
        SchemaVersion=1
        ComputerName=$env:COMPUTERNAME
        CreatedAt=(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK')
        Adapter=[pscustomobject]@{ InterfaceGuid=$guidText; InterfaceIndex=$index; Name=$Adapter.Name; InterfaceDescription=$Adapter.InterfaceDescription; MacAddress=$Adapter.MacAddress }
        IPv4Interface=[pscustomobject]@{ Dhcp=[string]$ipInterface.Dhcp; AutomaticMetric=[string]$ipInterface.AutomaticMetric; InterfaceMetric=[int]$ipInterface.InterfaceMetric }
        IPv4Addresses=$addresses
        DefaultRoutes=$routes
        DNS=[pscustomobject]@{ Mode=$dnsMode; ServerAddresses=@($dns.ServerAddresses); StaticNameServer=$staticDnsText }
        RequestedAddresses=@('192.168.10.100','192.168.1.100')
        AddedAddresses=@()
    }
}

function Show-SelectedNetworkState {
    param([Parameter(Mandatory=$true)]$State)
    Write-Host ''
    Write-Host ('选中网卡：{0}，编号 {1}，GUID {2}' -f $State.Adapter.Name, $State.Adapter.InterfaceIndex, $State.Adapter.InterfaceGuid) -ForegroundColor Cyan
    Write-Host ('当前 IPv4 DHCP：{0}；DNS 模式：{1}' -f $State.IPv4Interface.Dhcp, $State.DNS.Mode)
    $State.IPv4Addresses | Format-Table IPAddress, PrefixLength, PrefixOrigin, SkipAsSource -AutoSize | Out-Host
    if (@($State.DefaultRoutes).Count -gt 0) {
        Write-Host '当前默认网关：'
        $State.DefaultRoutes | Format-Table NextHop, RouteMetric, Protocol -AutoSize | Out-Host
    } else { Write-Host '当前默认网关：无' }
    Write-Host ('当前 DNS：{0}' -f (@($State.DNS.ServerAddresses) -join ', '))
}

function Test-DeviceTcpPort {
    param([string]$Device, [string]$Address, [int]$Port, [int]$TimeoutMilliseconds = 2000)
    $client = New-Object Net.Sockets.TcpClient
    $connected = $false
    try {
        $async = $client.BeginConnect($Address, $Port, $null, $null)
        if ($async.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)) {
            $client.EndConnect($async)
            $connected = $client.Connected
        }
        $async.AsyncWaitHandle.Close()
    } catch { $connected = $false }
    finally { $client.Close() }
    return [pscustomobject]@{ Device=$Device; Address=$Address; Port=$Port; Connected=$connected }
}

function Show-DeviceConnectivity {
    Write-Host ''
    Write-Host '设备 TCP 连通性检查（只建立连接，不登录、不改设备设置）：' -ForegroundColor Cyan
    @(
        Test-DeviceTcpPort -Device '雷达 TCP 数据' -Address '192.168.10.123' -Port 50000
        Test-DeviceTcpPort -Device '摄像头网页' -Address '192.168.1.11' -Port 80
        Test-DeviceTcpPort -Device '摄像头 RTSP 端口' -Address '192.168.1.11' -Port 554
    ) | Format-Table Device, Address, Port, Connected -AutoSize | Out-Host
    Write-Host 'Connected=True 仅表示对应 TCP 端口可达；不代表已登录、已有车辆目标或 RTSP 已能播放。'
    Write-Host '雷达软件占用连接或设备限制并发连接时，数据端口测试可能失败；先中止雷达连接后再检查。'
}
