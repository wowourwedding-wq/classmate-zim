@echo off
REM ClassMate Zim — one-click launcher.
REM Double-click this file to start the local web server and open the planner in your browser.

cd /d "%~dp0"

REM Try to find Python (py launcher or python.exe)
where py >nul 2>nul
if %ERRORLEVEL%==0 (
  set "PY=py"
) else (
  where python >nul 2>nul
  if %ERRORLEVEL%==0 (
    set "PY=python"
  ) else (
    echo Python is not installed. Please install Python 3 from python.org and try again.
    pause
    exit /b 1
  )
)

REM Open the browser after a short delay so the server is ready
start "" /b cmd /c "timeout /t 1 /nobreak >nul && start http://localhost:4182"

REM Start the server (this window stays open while ClassMate is running)
echo.
echo ClassMate Zim is running at http://localhost:4182
echo Close this window when you are done.
echo.
%PY% -m http.server 4182
