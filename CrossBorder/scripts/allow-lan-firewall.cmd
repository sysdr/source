@echo off
REM Run once as Administrator to allow LAN access to Suez API + Vite.
netsh advfirewall firewall add rule name="Suez API TCP 3001" dir=in action=allow protocol=TCP localport=3001 profile=any
netsh advfirewall firewall add rule name="Suez Vite TCP 9000" dir=in action=allow protocol=TCP localport=9000 profile=any
echo Done. Other Wi-Fi devices can use http://YOUR_LAN_IP:3001 and http://YOUR_LAN_IP:9000
pause
