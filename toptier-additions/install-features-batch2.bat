@echo off
REM ============================================================
REM TOPTIER Batch 2 Feature Installer
REM Copies all batch-2 feature files into your project
REM Run from: C:\Users\ravenz\Desktop\ANALYSER
REM ============================================================

setlocal
set SRC=%~dp0toptier-additions
set DEST=%~dp0

echo ===================================================
echo TOPTIER Batch 2 Installer
echo Source: %SRC%
echo ===================================================

if not exist "%SRC%" (
  echo ERROR: toptier-additions folder not found.
  pause
  exit /b 1
)

echo.
echo [1/9] Installing npm packages...
cmd /c npm install stripe next-auth @next-auth/prisma-adapter otpauth qrcode nodemailer bcryptjs

echo.
echo [2/9] Copying lib files...
xcopy /Y /I "%SRC%\src\lib\*" "%DEST%src\lib\"

echo.
echo [3/9] Copying hooks...
xcopy /Y /I "%SRC%\src\hooks\*" "%DEST%src\hooks\"

echo.
echo [4/9] Copying components...
xcopy /Y /I "%SRC%\src\components\*" "%DEST%src\components\" /S

echo.
echo [5/9] Copying API routes (batch 2 only)...
xcopy /Y /I "%SRC%\src\app\api\stripe" "%DEST%src\app\api\stripe\" /S /E
xcopy /Y /I "%SRC%\src\app\api\auth" "%DEST%src\app\api\auth\" /S /E
xcopy /Y /I "%SRC%\src\app\api\social" "%DEST%src\app\api\social\" /S /E
xcopy /Y /I "%SRC%\src\app\api\risk" "%DEST%src\app\api\risk\" /S /E
xcopy /Y /I "%SRC%\src\app\api\bots" "%DEST%src\app\api\bots\" /S /E
xcopy /Y /I "%SRC%\src\app\api\stream" "%DEST%src\app\api\stream\" /S /E
xcopy /Y /I "%SRC%\src\app\api\health" "%DEST%src\app\api\health\" /S /E

echo.
echo [6/9] Copying middleware...
xcopy /Y "%SRC%\src\middleware.ts" "%DEST%src\"

echo.
echo [7/9] Copying i18n locales...
xcopy /Y /I "%SRC%\public\locales" "%DEST%public\locales\" /S /E

echo.
echo [8/9] Copying infrastructure + monitoring...
xcopy /Y /I "%SRC%\infrastructure" "%DEST%infrastructure\" /S /E
xcopy /Y /I "%SRC%\monitoring" "%DEST%monitoring\" /S /E
xcopy /Y "%SRC%\docker\Dockerfile" "%DEST%"
xcopy /Y "%SRC%\docker\docker-compose.yml" "%DEST%"
xcopy /Y "%SRC%\docker\.dockerignore" "%DEST%"

echo.
echo [9/9] Copying mobile app...
xcopy /Y /I "%SRC%\mobile-app" "%DEST%mobile-app\" /S /E

echo.
echo ===================================================
echo Files copied! Now do these manual steps:
echo.
echo 1. Open prisma\schema.prisma and APPEND the contents
echo    of toptier-additions\prisma\schema-additions-batch2.prisma
echo    Also add the relations listed in comments to your User model
echo
echo 2. Append .env.batch2.example to your .env file
echo    Get API keys from:
echo    - Stripe: https://dashboard.stripe.com/apikeys
echo    - Google: https://console.cloud.google.com/apis/credentials
echo    - GitHub: https://github.com/settings/developers
echo    - Twitter: https://developer.twitter.com
echo    Run: openssl rand -base64 32  (for NEXTAUTH_SECRET)
echo
echo 3. Run prisma migration:
echo    cmd /c npx prisma db push
echo    cmd /c npx prisma generate
echo
echo 4. Configure Stripe webhook:
echo    https://dashboard.stripe.com/webhooks
echo    Endpoint: https://localhost/api/stripe/webhook
echo    Events: checkout.session.completed, customer.subscription.*, invoice.*
echo
echo 5. Add new navigation in your sidebar:
echo    - TradingView Charts page
echo    - Social Feed (/api/social/feed)
echo    - Leaderboard (/api/social/leaderboard)
echo    - Risk Dashboard (/api/risk)
echo    - Trading Bots (/api/bots)
echo    - Settings (2FA, Sessions, Push)
echo
echo 6. (Optional) Start full Docker stack:
echo    docker-compose up -d
echo    Then visit:
echo      https://localhost          (app)
echo      http://localhost:3001      (Grafana)
echo      http://localhost:9090      (Prometheus)
echo      http://localhost:3002      (Uptime Kuma)
echo ===================================================
pause
