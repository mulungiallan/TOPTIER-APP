@echo off
echo ============================================
echo    TOPTIER - Database Setup
echo ============================================
echo.

:: Create db folder if it doesn't exist
if not exist "db" mkdir db

:: Step 1: Push Prisma schema to create database tables
echo [1/3] Creating database tables...
call npx prisma db push
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to create database tables.
    echo Make sure you have run: npm install
    pause
    exit /b 1
)

:: Step 2: Generate Prisma Client
echo.
echo [2/3] Generating Prisma Client...
call npx prisma generate
if %errorlevel% neq 0 (
    echo.
    echo ERROR: Failed to generate Prisma Client.
    pause
    exit /b 1
)

:: Step 3: Create admin user
echo.
echo [3/3] Creating admin user...
call npx tsx prisma/seed.ts
if %errorlevel% neq 0 (
    echo.
    echo Admin user seeding skipped (or already exists).
    echo You can create an account via the app.
)

echo.
echo ============================================
echo    Database setup complete!
echo ============================================
echo.
echo Now start the app with:
echo     start.bat
echo   OR:
echo     cmd /c npx next dev -p 3000
echo.
echo Or use Demo Mode to skip login entirely.
echo.
pause
