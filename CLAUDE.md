# Siryous CRM — notes for AI coding sessions

- **System of record:** `data/crm.db` (SQLite, WAL). Never write to it with ad-hoc
  scripts while the app or MCP server may be running; use the app, the MCP
  tools, or the scripts in `scripts/`. There is no import script — do not recreate one
  that wipes tables.
- **Schema and migrations** live in `lib/schema.mjs` (shared by the app and
  `scripts/mcp-server.mjs`). Add columns with the `ALTER TABLE` list there.
- **Personal configuration** is `config/owner.json` (gitignored). Never hardcode an
  owner's name, email, practice, or filesystem paths in tracked files — read them
  via `loadOwner()` from `lib/owner.mjs`. Contact and company names belong in the
  database, not in code, prompts, or examples.
- **AI routing:** tool-less "write" steps go through `runModel` (local Ollama, Claude
  CLI fallback only when Ollama is unavailable); steps that need Gmail/Calendar/
  Zoom/Drive/web go through `runClaudeStream` with an explicit read-only tool grant.
  Nothing the models produce is saved without a review screen, except Coach's
  action-item updates.
- **Vocabulary** (statuses, stages, buckets, cadences) is in `lib/db.ts`; the MCP
  server keeps a copy — change both.
- **Check before committing:** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`
  and `node --check scripts/mcp-server.mjs`. The server binds to 127.0.0.1 only.
- **Deploy locally:** `./Stop CRM.command && ./Start CRM.command` (rebuilds when source
  changed) or `npm run build && npm start`.
