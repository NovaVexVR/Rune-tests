#!/bin/bash
# Start the 5 scripted bots and the 5 Claude-directed bots (needs the server running).
cd "$(dirname "$0")"
NODE=${NODE:-node}
pkill -f scripted.mjs; pkill -f claude_runner.mjs
nohup $NODE scripted.mjs 10 scriptbot >> logs/scripted.out 2>&1 &
nohup $NODE claude_runner.mjs 5 >> logs/claude_runner.out 2>&1 &
echo started
