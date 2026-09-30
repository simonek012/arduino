@echo off
chcp 65001 >nul
title Riskuj! s mobilmi - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
