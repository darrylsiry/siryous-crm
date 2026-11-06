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

# Is this CRM answering (not just something on port 3000)? scripts/crm-check.mjs
# sends a random nonce to /api/health and checks the answer is a proof only a
# server holding this CRM's token can make. Without Node there is no CRM.
is_up() { command -v node >/dev/null 2>&1 && node scripts/crm-check.mjs "$URL" >/dev/null 2>&1; }
# Is anything at all answering on the address?
port_busy() { curl -s -o /dev/null --max-time 2 "$URL/"; }

# The app is locked to this machine with a private token (README, "Signing
# in"). The browser is signed in with a one-time code that works once, for two
# minutes (lib/auth.mjs createSignInCode), so the token itself never appears in
# a URL, the browser's history or this command's arguments. The code is kept
# next to the database, with CRM_DB_PATH taken from this environment or from
# .env.local (read the way Next.js reads it). Without one, the plain address
# opens the sign-in page.
open_app() {
  local code
  code=$(node -e 'require("@next/env").loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
import("./lib/auth.mjs").then((m) => console.log(m.createSignInCode()));' 2>/dev/null)
  if [ -n "$code" ]; then
    open "$URL/?once=$code"
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
# Something else answers on port 3000. The CRM may still be able to start
# beside it (a program listening on every address leaves 127.0.0.1 free), so
# try; it's only opened once it really is the CRM answering.
OTHER_ON_PORT=no
if port_busy; then
  OTHER_ON_PORT=yes
  echo "Another program is answering on port 3000 (it isn't the CRM) — trying to start the CRM beside it…"
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
  fi
  # npm ci installs exactly what package-lock.json lists, and never rewrites
  # it. It starts from an empty node_modules, so everything (the database
  # component included) is freshly built for this Node.
  npm ci --no-audit --no-fund || fail "Installing failed — see the messages above." \
"Usually this means no internet connection. Connect and try again."
  FRESH_INSTALL=yes
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
# The data folder, and the log and files the server creates, readable by this account only.
chmod 700 data 2>/dev/null
umask 077
CRM_NO_OPEN=1 nohup npm start > data/server.log 2>&1 &

for i in {1..60}; do
  sleep 1
  is_up && break
done

if ! is_up; then
  if [ "$OTHER_ON_PORT" = yes ]; then
    fail "Another program is using the address the CRM needs (port 3000), so the CRM couldn't start." \
"Quit that program and double-click Start CRM.command again. Nothing has been changed."
  fi
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
