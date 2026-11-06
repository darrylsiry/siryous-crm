#!/bin/zsh
# Double-click to restart Siryous CRM: stops the running server, then starts
# it again (rebuilding first if the app was updated) and opens it in your
# browser. Same as running Stop CRM.command followed by Start CRM.command.
cd "$(dirname "$0")" || exit 1

echo "Stopping Siryous CRM…"
zsh "./Stop CRM.command" || exit 1

# Wait for the old CRM to let go of port 3000 before starting a new one
# (Start CRM.command would otherwise find it still there). Only the CRM's own
# listener, the one running from this folder, is waited for: another program
# on the port is left alone by Stop, so waiting for it would never end.
HERE="$(pwd -P)"
crm_listening() {
  local pid cwd
  for pid in $(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
    [ "$cwd" = "$HERE" ] && return 0
  done
  return 1
}
if command -v lsof >/dev/null 2>&1; then
  for i in {1..20}; do
    crm_listening || break
    sleep 0.5
  done
else
  sleep 3
fi

echo ""
exec zsh "./Start CRM.command"
