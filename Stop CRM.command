#!/bin/zsh
# Double-click to stop the Siryous CRM server that Start CRM.command started.
# Your data is safe either way — stopping just closes the app.
cd "$(dirname "$0")" || exit 1

if command -v lsof >/dev/null 2>&1; then
  # Whatever is listening on port 3000 is the CRM server (it binds 127.0.0.1:3000).
  PIDS=$(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null)
  if [ -n "$PIDS" ]; then
    if kill ${=PIDS}; then
      echo "Siryous CRM stopped (ended process ${PIDS//$'\n'/, } on port 3000)."
    else
      echo "Couldn't stop process ${PIDS//$'\n'/, } — try quitting Terminal, or restart the Mac."
      exit 1
    fi
  else
    echo "Siryous CRM wasn't running (nothing is listening on port 3000)."
  fi
else
  # No lsof on this machine: stop the Next.js server processes by name instead
  # (the listener renames itself "next-server"; "next start" is its wrapper).
  if pkill -f "next-server|next start"; then
    echo "Siryous CRM stopped (ended the \"next start\" processes)."
  else
    echo "Siryous CRM wasn't running (no \"next start\" process found)."
  fi
fi

echo "You can close this window. Double-click Start CRM.command to start it again."
