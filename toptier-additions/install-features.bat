@echo off
REM ============================================================
REM TOPTIER Feature Installer
REM Copies all new feature files into your project
REM Run from: C:\Users\ravenz\Desktop\ANALYSER
REM ============================================================

setlocal
set SRC=%~dp0toptier-additions
set DEST=%~dp0

echo ===================================================
echo TOPTIER Feature Installer
echo Source: %SRC%
echo Destination: %DEST%
echo ===================================================

if not exist "%SRC%" (
  echo ERROR: toptier-additions folder not found.
  echo Please extract toptier-features.zip in your project root first.
  pause
  exit /b 1
)

echo.
echo [1/8] Copying lib files...
xcopy /Y /I "%SRC%\src\lib\*" "%DEST%src\lib\"

echo.
echo [2/8] Copying hooks...
xcopy /Y /I "%SRC%\src\hooks\*" "%DEST%src\hooks\"

echo.
echo [3/8] Copying components...
xcopy /Y /I "%SRC%\src\components\*" "%DEST%src\components\" /S

echo.
echo [4/8] Copying API routes...
xcopy /Y /I "%SRC%\src\app\api\*" "%DEST%src\app\api\" /S /E

echo.
echo [5/8] Copying public assets...
xcopy /Y "%SRC%\public\sw.js" "%DEST%public\"
xcopy /Y "%SRC%\public\offline.html" "%DEST%public\"
xcopy /Y "%SRC%\public\manifest.json" "%DEST%public\"

echo.
echo [6/8] Installing npm packages...
cmd /c npm install web-push @sentry/nextjs

echo.
echo [7/8] Updating Prisma schema...
echo.
echo IMPORTANT: Open prisma\schema.prisma and manually append the contents
echo of toptier-additions\prisma\schema-additions.prisma
echo Then add these relations to your User model:
echo   pushSubscriptions PushSubscription[]
echo   paperAccount      PaperAccount?
echo   paperPositions    PaperPosition[]
echo   paperTrades       PaperTrade[]
echo   priceAlerts       PriceAlert[]
echo   backtestRuns      BacktestRun[]
echo.
pause

echo.
echo [8/8] Running prisma db push...
cmd /c npx prisma db push
cmd /c npx prisma generate

echo.
echo ===================================================
echo Installation complete!
echo.
echo Next steps:
echo 1. Append .env.example contents to your .env file
echo 2. Get API keys:
echo    - NewsAPI: https://newsapi.org/register
echo    - Alpha Vantage: https://www.alphavantage.co/support/#api-key
echo    - OpenAI: https://platform.openai.com/api-keys
echo    - VAPID keys: npx web-push generate-vapid-keys
echo 3. Add navigation buttons in your sidebar for:
echo    - News (setPage "news")
echo    - Paper Trading (setPage "paper-trading")
echo    - Backtest (setPage "backtest")
echo 4. Start the app: cmd /c npx next dev -p 3000
echo 5. Visit http://localhost:3000/api/docs for Swagger UI
echo ===================================================
pause
