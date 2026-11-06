#!/bin/zsh
# Double-click to stop the Siryous CRM server that Start CRM.command started.
# Your data is safe either way — stopping just closes the app.
cd "$(dirname "$0")" || exit 1

HERE="$(pwd -P)"
if command -v lsof >/dev/null 2>&1; then
  # Only the CRM's own server: a listener on port 3000 whose working folder is
  # this one. Any other program on the port (another local app) is left alone.
  CRM_PIDS=()
  OTHER=no
  for pid in $(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null); do
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
    if [ "$cwd" = "$HERE" ]; then CRM_PIDS+=("$pid"); else OTHER=yes; fi
  done
  if [ ${#CRM_PIDS[@]} -gt 0 ]; then
    if kill "${CRM_PIDS[@]}"; then
      echo "Siryous CRM stopped."
    else
      echo "Couldn't stop the CRM — try quitting Terminal, or restart the Mac."
      exit 1
    fi
  else
    echo "Siryous CRM wasn't running."
  fi
  [ "$OTHER" = yes ] && echo "(Another program is using port 3000; it was left running.)"
else
  # No lsof on this machine: stop the Next.js server processes started from
  # this folder by name instead (the listener renames itself "next-server").
  if pkill -f "$HERE/node_modules/.*next"; then
    echo "Siryous CRM stopped."
  else
    echo "Siryous CRM wasn't running."
  fi
fi

echo "You can close this window. Double-click Start CRM.command to start it again."
