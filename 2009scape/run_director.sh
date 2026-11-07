#!/bin/sh
# Run a director pass if one is due (daily, or sooner on an alert). Schedule it hourly, e.g. with cron:
#   0 * * * * cd /path/to/Rune-tests/2009scape && ./run_director.sh >> bots/director/cron.log 2>&1
cd "$(dirname "$0")/bots" || exit 1
node director.mjs due || exit 0
node director.mjs brief || exit 1
cd ..
claude -p "Follow the instructions in DIRECTOR.md (in this folder) for a director pass." --allowedTools "Read,Edit,Write,Bash(node bots/director.mjs done)"
