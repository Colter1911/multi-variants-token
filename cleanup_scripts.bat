@echo off
git git rm attempt_merge.bat
git rm auto_merge.bat
git rm check_branch.bat
git rm check_status.bat
git rm current_branch.txt
git rm resolve_conflicts.bat
git commit -m "Remove temporary merge support scripts"
git push origin main
