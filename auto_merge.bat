@echo off
setlocal

:: Get current branch check
for /f "tokens=*" %%i in ('git branch --show-current') do set CURRENT_BRANCH=%%i
echo Current branch is: %CURRENT_BRANCH%

if "%CURRENT_BRANCH%"=="main" (
    echo Already on main branch. Nothing to merge into main.
    exit /b 0
)

:: Checkout main
echo Switching to main...
git checkout main
if %errorlevel% neq 0 (
    echo Failed to checkout main. You might have dirty files.
    exit /b %errorlevel%
)

:: Pull main
echo Pulling latest main...
git pull origin main

:: Merge
echo Merging %CURRENT_BRANCH% into main...
git merge %CURRENT_BRANCH%
if %errorlevel% neq 0 (
    echo MERGE CONFLICT DETECTED
    exit /b 1
)

:: Push
echo Pushing to remote...
git push origin main

echo DONE
endlocal
