@echo off
cd /d "%~dp0"
title ChungusHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev.ps1"
echo.
echo [ChungusHub] Server stopped.
pause
