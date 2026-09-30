@echo off
chcp 65001 >nul
title Riskuj! cez internet - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0online.ps1"
pause
