@echo off
chcp 65001 >nul
cd /d "%~dp0"
E:\Python312\python.exe -m PyInstaller --noconfirm --clean --onefile --windowed --name QUANTA --icon assets\icon.ico --add-data "web;web" --add-data "assets\icon.ico;assets" --collect-all webview main.py
echo.
echo Build finished: dist\QUANTA.exe
pause
