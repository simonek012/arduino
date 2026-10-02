@echo off
chcp 65001 >nul
title Kto? Co? Kolko? cez internet - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0online.ps1"
pause
