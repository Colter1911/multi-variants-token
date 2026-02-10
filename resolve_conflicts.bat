@echo off
setlocal
echo Resolving conflicts by accepting "theirs" (incoming changes)...

:: Checkout "theirs" for all files
git checkout --theirs .
if %errorlevel% neq 0 (
    echo Failed to checkout theirs
    exit /b %errorlevel%
)

:: Add all changes
git add .
if %errorlevel% neq 0 (
    echo Failed to add changes
    exit /b %errorlevel%
)

:: Commit
git commit -m "Merge branch 'codex/save-foundry-vtt-module-development-rules-z0dky8' into main"
if %errorlevel% neq 0 (
    echo Failed to commit
    exit /b %errorlevel%
)

:: Push
git push origin main
if %errorlevel% neq 0 (
    echo Failed to push
    exit /b %errorlevel%
)

echo MERGE RESOLVED AND PUSHED
endlocal
