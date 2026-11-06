#!/bin/bash
# (Re)start the 2009Scape server with the bot API on 127.0.0.1:8899.
# Usage: ./restart.sh [path-to-2009scape-checkout]   (default: ../2009scape-server next to this repo)
HERE=$(cd "$(dirname "$0")" && pwd)
SRV=${1:-$HERE/../../2009scape-server}
[ -n "$JAVA11_HOME" ] && export JAVA_HOME=$JAVA11_HOME PATH=$JAVA11_HOME/bin:$PATH
cd "$SRV/Server" || exit 1
pkill -f "server-1.0.0-jar-with-dependencies|server-running.jar"; sleep 4
# run a copy of the jar, so a rebuild while the server is up can't break the running server
cp target/server-1.0.0-jar-with-dependencies.jar target/server-running.jar
nohup java -Dnashorn.args=--no-deprecation-warning -jar target/server-running.jar > "$HERE/server.log" 2>&1 &
for i in $(seq 1 120); do grep -qE "started in" "$HERE/server.log" && break; sleep 2; done
tail -3 "$HERE/server.log"
