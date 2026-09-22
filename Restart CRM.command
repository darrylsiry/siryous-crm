#!/bin/zsh
# Double-click to restart Siryous CRM: stops the running server, then starts
# it again (rebuilding first if the app was updated) and opens it in your
# browser. Same as running Stop CRM.command followed by Start CRM.command.
cd "$(dirname "$0")" || exit 1

echo "Stopping Siryous CRM…"
zsh "./Stop CRM.command" || exit 1

# Wait for the old server to let go of port 3000 before starting a new one
# (Start CRM.command would otherwise think it is still running and just open it).
if command -v lsof >/dev/null 2>&1; then
  for i in {1..20}; do
    [ -z "$(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null)" ] && break
    sleep 0.5
  done
else
  sleep 3
fi

echo ""
exec zsh "./Start CRM.command"
