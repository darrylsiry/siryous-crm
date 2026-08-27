#!/bin/zsh
# Double-click to start Siryous CRM and open it in your browser.
cd "$(dirname "$0")"

# The app is locked to this machine with a token in data/auth-token (see
# README, "Access"). Opening it with ?token= signs this browser in once.
open_app() {
  if [ -f data/auth-token ]; then
    open "http://localhost:3000/?token=$(cat data/auth-token)"
  else
    open http://localhost:3000
  fi
}

# Already running? Just open it.
if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
  open_app
  exit 0
fi

# Build the production bundle on first run, or whenever the source has
# changed since the last build (so an update actually takes effect).
if [ ! -f .next/BUILD_ID ]; then
  echo "Building the app (first run, ~1 minute)…"
  npm run build || { echo "Build failed — see above."; exit 1; }
elif [ -n "$(find app lib components package.json next.config.ts tsconfig.json -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Source changed since the last build — rebuilding (~1 minute)…"
  npm run build || { echo "Build failed — see above."; exit 1; }
fi

echo "Starting Siryous CRM…"
mkdir -p data
nohup npm start > data/server.log 2>&1 &

for i in {1..30}; do
  sleep 1
  if curl -s -o /dev/null --max-time 2 http://localhost:3000/; then
    break
  fi
done

open_app
echo "Running at http://localhost:3000 — this window can be closed."
