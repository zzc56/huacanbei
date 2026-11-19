@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 22.12+ from https://nodejs.org/
  pause
  exit /b 1
)
node launch.mjs recording
pause
