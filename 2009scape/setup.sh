#!/bin/bash
# One-time setup: clone 2009Scape next to this repo, apply the bot API, build, and restore bot saves.
# Needs: git, git-lfs, JDK 11 (JAVA11_HOME or default java), Node.js 22+.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
SRV=${1:-$HERE/../../2009scape-server}
[ -n "$JAVA11_HOME" ] && export JAVA_HOME=$JAVA11_HOME PATH=$JAVA11_HOME/bin:$PATH
if [ ! -d "$SRV" ]; then
  git clone --depth 1 https://gitlab.com/2009scape/2009scape.git "$SRV"
  (cd "$SRV" && git lfs install --local && git lfs pull)
fi
mkdir -p "$SRV/Server/src/main/content/botapi"
cp "$HERE/server-patch/content/botapi/BotApi.kt" "$SRV/Server/src/main/content/botapi/"
(cd "$SRV" && git apply --3way "$HERE/server-patch/core-changes.patch" || echo "patch already applied?")
mkdir -p "$SRV/Server/data/players"
cp -n "$HERE"/saves/*.json "$SRV/Server/data/players/" 2>/dev/null || true
(cd "$SRV/Server" && sh mvnw -q -B package -DskipTests)
echo "Built. Start with: $HERE/restart.sh \"$SRV\"   then: $HERE/bots/start-bots.sh"
