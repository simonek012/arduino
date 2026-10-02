@echo off
chcp 65001 >nul
title Kto? Co? Kolko? - server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
pause
