@echo off
echo ============================================
echo    TOPTIER - Starting Application
echo ============================================
echo.

:: Check if node_modules exists
if not exist "node_modules" (
    echo [1/2] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed.
        pause
        exit /b 1
    )
) else (
    echo [1/2] Dependencies already installed. Skipping.
)

:: Check if database exists
if not exist "db\custom.db" (
    echo.
    echo [2/2] Database not found. Setting up...
    call setup-db.bat
) else (
    echo [2/2] Database found. Skipping setup.
)

echo.
echo ============================================
echo    Starting TOPTIER on http://localhost:3000
echo ============================================
echo.
echo Press Ctrl+C to stop the server.
echo.

call npx next start -p 3000
