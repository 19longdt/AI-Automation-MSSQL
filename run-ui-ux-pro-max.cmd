@echo off
setlocal

set "SKILL_DIR=C:\Users\Admin\.codex\skills\ui-ux-pro-max"
set "PYTHON_EXE="

if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  set "PYTHON_EXE=%LocalAppData%\Programs\Python\Python312\python.exe"
) else if exist "%LocalAppData%\Python\bin\python3.exe" (
  set "PYTHON_EXE=%LocalAppData%\Python\bin\python3.exe"
) else if exist "%LocalAppData%\Python\bin\python.exe" (
  set "PYTHON_EXE=%LocalAppData%\Python\bin\python.exe"
) else (
  set "PYTHON_EXE=python"
)

if not exist "%SKILL_DIR%\scripts\search.py" (
  echo Skill script not found: "%SKILL_DIR%\scripts\search.py"
  exit /b 1
)

"%PYTHON_EXE%" "%SKILL_DIR%\scripts\search.py" %*
exit /b %ERRORLEVEL%
