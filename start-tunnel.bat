@echo off
title TOPTIER - Cloudflare Tunnel
echo Starting TOPTIER server...
cd /d C:\Users\Admin\Desktop\app
start /B node .next\standalone\server.js
timeout /t 3 >nul
echo Starting Cloudflare Tunnel...
C:\Cloudflare\cloudflared.exe tunnel --config C:\Cloudflare\config.yml run toptier
