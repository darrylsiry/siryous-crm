#!/bin/sh
# Manual backup of the CRM database (the app and the MCP server also do this
# automatically once a day while running). Destination: $CRM_BACKUP_DIR, or
# data/backups next to the database.
set -e
cd "$(dirname "$0")/.."
DEST="${CRM_BACKUP_DIR:-data/backups}"
mkdir -p "$DEST"
STAMP=$(date +%Y-%m-%d)
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 data/crm.db ".backup '$DEST/crm-$STAMP.db'"
else
  node -e "const D=require('better-sqlite3');new D('data/crm.db',{readonly:true}).backup(process.argv[1])" "$DEST/crm-$STAMP.db"
fi
echo "Backed up to $DEST/crm-$STAMP.db"
