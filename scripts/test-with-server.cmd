@echo off
rem Runs Breeze's server-backed tests end to end. Same arguments as test-with-server.ps1,
rem for example:  scripts\test-with-server.cmd -Tier all
rem This wrapper exists because Windows blocks running .ps1 files directly by default.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-with-server.ps1" %*
exit /b %ERRORLEVEL%
