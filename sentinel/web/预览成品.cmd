@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 22.12+ from https://nodejs.org/
  pause
  exit /b 1
)
if not exist dist\index.html (
  echo [ERROR] dist\index.html missing. Run npm install and npm run build first.
  pause
  exit /b 1
)
start "" http://127.0.0.1:4173/
node scripts\serve-dist.mjs
pause
