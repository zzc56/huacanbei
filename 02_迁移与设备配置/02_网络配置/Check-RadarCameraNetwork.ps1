[CmdletBinding()]
param([int]$InterfaceIndex = 0)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Network-Common.ps1')
try {
    $adapter = Select-WiredPhysicalAdapter -InterfaceIndex $InterfaceIndex
    Show-SelectedNetworkState -State (Get-SelectedNetworkState -Adapter $adapter)
    Write-Host '这是只读检查：不写备份、不更改任何网卡。'
    Show-DeviceConnectivity
    Write-Host '检查不通时，确认三根网线都接交换机、雷达和摄像头分别通电，以及所选网卡实际连着交换机。'
} catch {
    Write-Host ('检查失败：{0}' -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
