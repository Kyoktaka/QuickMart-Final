@echo off
cd /d "%~dp0"
python rfid_bridge.py --debug run
pause
