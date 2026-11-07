@echo off
rem Run a director pass if one is due (daily, or sooner on an alert). Schedule it hourly with Task Scheduler:
rem   schtasks /create /sc hourly /tn "Rune director" /tr "C:\path\to\Rune-tests\2009scape\run_director.cmd"
cd /d "%~dp0bots"
node director.mjs due || exit /b 0
node director.mjs brief || exit /b 1
cd ..
claude -p "Follow the instructions in DIRECTOR.md (in this folder) for a director pass." --allowedTools "Read,Edit,Write,Bash(node bots/director.mjs done)"
