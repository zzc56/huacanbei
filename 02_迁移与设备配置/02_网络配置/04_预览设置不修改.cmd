@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Set-RadarCameraNetwork.ps1" -DryRun %*
pause
