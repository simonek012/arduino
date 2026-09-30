@echo off
chcp 65001 >nul
title Co ja viem cez internet - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0online.ps1"
pause
