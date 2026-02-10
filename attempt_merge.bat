@echo off
setlocal
set DIRTY=
for /f "tokens=*" %%i in ('git status --porcelain') do set DIRTY=1
if defined DIRTY (
  echo Working directory is dirty. Please commit or stash changes.
  exit /b 1
)

git checkout main
if %errorlevel% neq 0 (
  echo Failed to checkout main
  exit /b %errorlevel%
)

git pull origin main
if %errorlevel% neq 0 echo Warning: git pull failed or no remote, continuing with local main...

git merge codex/save-foundry-vtt-module-development-rules-5tl8ma
if %errorlevel% neq 0 (
  echo MERGE CONFLICT DETECTED
  exit /b 1
)

echo MERGE SUCCESSFUL
endlocal
