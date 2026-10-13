@echo off
rem Doppio clic per avviare FantaIntelligence su Windows.
cd /d "%~dp0"
if exist ".node\node.exe" set "PATH=%CD%\.node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non e' installato. Si apre la pagina per scaricarlo: installa la versione LTS e poi riapri questo file.
  start "" "https://nodejs.org/it/download"
  pause
  exit /b 1
)
node scripts\avvia.mjs %*
if errorlevel 1 pause
