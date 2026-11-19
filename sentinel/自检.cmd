@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===== 1. Runtime and build artifact check =====
node launch.mjs --check
echo.
echo ===== 2. Device connectivity check (radar / camera) =====
node check-devices.mjs
echo.
pause
