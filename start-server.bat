@echo off
echo Starting Aurelia Restaurant PHP Server on http://127.0.0.1:8080 ...
start "" "http://127.0.0.1:8080/index.html"
php -S 127.0.0.1:8080 -t "%~dp0"
