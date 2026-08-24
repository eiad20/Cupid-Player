@echo off
set ELECTRON_DISABLE_SECURITY_WARNINGS=true
if not exist "node_modules" npm install
bin\yt-dlp.exe -U
npm run dev