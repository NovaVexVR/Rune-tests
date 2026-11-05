#!/bin/bash
# Screenshot the game view next to a bot: ./snap.sh <botname> [outfile]
# Needs Xvfb :99 with the rt4 client logged in as "spectator" (an admin dev account).
export DISPLAY=:99
BOT=$1; OUT=${2:-$(dirname "$0")/shots/$BOT.png}
mkdir -p "$(dirname "$OUT")"
read X Y Z < <(curl -s "localhost:8899/bot/$BOT/state?r=0" | python3 -c "import json,sys; s=json.load(sys.stdin); print(s['x'], s["y"], s['z'])")
xdotool mousemove 390 470 click 1   # focus chat
xdotool type --delay 40 "::tele $X $Y $Z"; xdotool key Return
sleep 4
import -window root -crop 516x340+132+0 "$OUT"
echo "$OUT"
