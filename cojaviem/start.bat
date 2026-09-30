@echo off
chcp 65001 >nul
title Co ja viem - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
