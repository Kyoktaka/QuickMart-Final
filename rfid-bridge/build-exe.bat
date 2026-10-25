@echo off
cd /d "%~dp0"
pip install -r requirements.txt
pyinstaller --onefile --name rfid_bridge --collect-all libusb_package rfid_bridge.py
copy /Y rfid_bridge.json dist\rfid_bridge.json
echo.
echo Done: dist\rfid_bridge.exe + dist\rfid_bridge.json  (copy both to cashier PC)
pause
