@echo off
rem Start the 5 scripted bots and the 10 Claude-directed bots (server must be running).
cd /d %~dp0
if not exist logs mkdir logs
start "scripted bots" /min cmd /c "node scripted.mjs 5 scriptbot > logs\scripted.out 2>&1"
start "claude bots" /min cmd /c "node claude_runner.mjs 5 > logs\claude_runner.out 2>&1"
echo started
