#!/bin/zsh
# Double-click to stop the Siryous CRM server.
PIDS=$(lsof -nP -tiTCP:3000 -sTCP:LISTEN)
if [ -n "$PIDS" ]; then
  kill $PIDS
  echo "Siryous CRM stopped."
else
  echo "Siryous CRM wasn't running."
fi
