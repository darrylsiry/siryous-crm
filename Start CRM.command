#!/bin/zsh
# Double-click to start Siryous CRM and open it in your browser.
#
# Safe to run any time: if the CRM is already running it just opens it. The
# first run installs the app's components and builds it (a few minutes); after
# that it starts in a few seconds. Everything happens inside this folder.
cd "$(dirname "$0")" || exit 1

URL="http://127.0.0.1:3000"   # keep 127.0.0.1 — the sign-in cookie is tied to this exact address

# Where the Node installer (nodejs.org) and common alternatives put `node`,
# in case Terminal's PATH doesn't already include them.
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1

is_up() { curl -s -o /dev/null --max-time 2 "$URL/"; }

# The app is locked to this machine with a private token (README, "Signing
# in"). Opening it with ?token= signs this browser in once. The token sits next
# to the database, so ask lib/auth.mjs where the server keeps it, with
# CRM_DB_PATH taken from this environment or from .env.local (read the way
# Next.js reads it); data/auth-token if that doesn't work.
open_app() {
  local token_file
  token_file=$(node -e 'require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
import("./lib/auth.mjs").then((m) => console.log(m.tokenPath()));' 2>/dev/null)
  [ -n "$token_file" ] || token_file="data/auth-token"
  if [ -f "$token_file" ]; then
    open "$URL/?token=$(cat "$token_file")"
  else
    open "$URL"
  fi
}

fail() {
  echo ""
  echo "$1"
  [ -n "$2" ] && echo "$2"
  echo ""
  echo "Fix the problem and double-click Start CRM.command again."
  exit 1
}

# Already running? Just open it.
if is_up; then
  echo "Siryous CRM is already running — opening it in your browser."
  open_app
  echo "Running at $URL — you can close this window."
  exit 0
fi

# 1. Node.js (the engine the CRM runs on). The .pkg from nodejs.org is enough.
#    Supported versions: keep these two in step with "engines" in package.json.
NODE_MIN=22
NODE_MAX=26
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "Node.js isn't installed yet — the CRM needs it to run." \
"Download it from https://nodejs.org (click the big LTS button), open the .pkg and click Continue until it says Done."
fi
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt "$NODE_MIN" ] 2>/dev/null; then
  fail "Your Node.js is too old ($(node -v)); the CRM needs version $NODE_MIN to $NODE_MAX." \
"Download the current LTS version from https://nodejs.org and install it over the old one."
fi
if [ "$NODE_MAJOR" -gt "$NODE_MAX" ] 2>/dev/null; then
  fail "Your Node.js is newer than the CRM supports yet ($(node -v)); it needs version $NODE_MIN to $NODE_MAX." \
"Download the LTS version from https://nodejs.org and install it over this one."
fi

# 2. The app's components (node_modules). Reinstall when the lock file changed,
#    i.e. after an update to the CRM itself.
FRESH_INSTALL=no
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  if [ -d node_modules ]; then
    echo "The CRM was updated — refreshing its components (about a minute)…"
  else
    echo "Installing the app's components (one-time, about a minute)…"
    FRESH_INSTALL=yes
  fi
  npm install --no-audit --no-fund || fail "Installing failed — see the messages above." \
"Usually this means no internet connection. Connect and try again."
fi

# 2b. Node was updated, or the folder came from another Mac: the database
#     component is compiled for one Node version, so rebuild it to match. A
#     fresh install has just compiled it for this one; otherwise rebuild when
#     the recorded version differs or there is no record (an install from
#     before this check existed).
NODE_STAMP="node_modules/.crm-node-version"
if [ "$FRESH_INSTALL" = no ] && [ "$(cat "$NODE_STAMP" 2>/dev/null)" != "$(node -v)" ]; then
  if [ -f "$NODE_STAMP" ]; then
    echo "Node.js changed ($(cat "$NODE_STAMP") → $(node -v)) — rebuilding the database component…"
  else
    echo "Making sure the database component matches your Node.js ($(node -v))…"
  fi
  npm rebuild better-sqlite3 || fail "Rebuilding failed — see the messages above." \
"Delete the node_modules and .next folders inside the CRM folder and try again."
fi
node -v > "$NODE_STAMP"

# 3. Build the production bundle on first run, or whenever the source has
#    changed since the last build (so an update actually takes effect).
if [ ! -f .next/BUILD_ID ]; then
  echo "Preparing the app for first use (a few minutes — this only happens once)…"
  npm run build || fail "Build failed — see above."
elif [ -n "$(find app lib components package.json package-lock.json next.config.ts tsconfig.json proxy.ts instrumentation.ts postcss.config.mjs -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "The CRM was updated — rebuilding (a few minutes)…"
  npm run build || fail "Build failed — see above."
fi

# 4. Start the server in the background; its output goes to data/server.log.
echo "Starting Siryous CRM…"
mkdir -p data
CRM_NO_OPEN=1 nohup npm start > data/server.log 2>&1 &

for i in {1..60}; do
  sleep 1
  is_up && break
done

if ! is_up; then
  echo ""
  echo "The CRM didn't start. The last lines of data/server.log are:"
  echo "----------------------------------------------------------------"
  tail -n 20 data/server.log 2>/dev/null
  echo "----------------------------------------------------------------"
  fail "See README.md, \"Troubleshooting\"."
fi

open_app
echo "Running at $URL — you can close this window."
echo "To stop it later, double-click Stop CRM.command."
