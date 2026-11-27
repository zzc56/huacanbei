#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$taskDirectory = $PSScriptRoot
try {
    $taskAdapter = Get-NetAdapter -InterfaceIndex 9
    if ($taskAdapter.MacAddress -ne 'EC-1A-C3-3F-5E-CE' -or $taskAdapter.Status -ne 'Up') { throw 'The expected connected USB Ethernet adapter is unavailable.' }
    foreach ($taskAddress in @('192.168.1.101','192.168.10.101')) {
        $taskExisting = @(Get-NetIPAddress -InterfaceIndex 9 -AddressFamily IPv4 -ErrorAction Stop | Where-Object { $_.IPAddress -eq $taskAddress })
        if ($taskExisting.Count -eq 0) { New-NetIPAddress -InterfaceIndex 9 -IPAddress $taskAddress -PrefixLength 24 -AddressFamily IPv4 -ErrorAction Stop | Out-Null }
    }
    [PSCustomObject]@{ Success = $true; AdapterIndex = 9; AddedAddresses = @('192.168.1.101','192.168.10.101'); GatewayAdded = $false; WirelessChanged = $false } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDirectory 'network-result.json') -Encoding UTF8
} catch {
    [PSCustomObject]@{ Success = $false; Message = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskDirectory 'network-result.json') -Encoding UTF8
    exit 1
}
