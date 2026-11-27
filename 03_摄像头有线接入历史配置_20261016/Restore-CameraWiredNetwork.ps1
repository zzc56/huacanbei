#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$taskAdapter = Get-NetAdapter -InterfaceIndex 9
if ($taskAdapter.MacAddress -ne 'EC-1A-C3-3F-5E-CE') { throw 'Adapter identity changed.' }
$taskBackup = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ethernet-before.json') -Raw | ConvertFrom-Json
foreach ($taskAddress in @('192.168.1.101','192.168.10.101')) {
    if ($taskBackup.Addresses.IPAddress -notcontains $taskAddress) {
        Get-NetIPAddress -InterfaceIndex 9 -IPAddress $taskAddress -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false
    }
}
if ($taskBackup.IPInterface.Dhcp -eq 1 -or $taskBackup.IPInterface.Dhcp -eq 'Enabled') {
    Set-NetIPInterface -InterfaceIndex 9 -AddressFamily IPv4 -Dhcp Enabled
}
Write-Output 'The task-specific USB Ethernet addresses have been restored to the recorded configuration.'
