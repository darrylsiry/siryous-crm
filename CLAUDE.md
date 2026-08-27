# Siryous CRM — notes for AI coding sessions

- **System of record:** `data/crm.db` (SQLite, WAL). Never write to it with ad-hoc
  scripts while the app or MCP server may be running; use the app, the MCP
  tools, or the scripts in `scripts/`. The CSV importer (`scripts/import-csv.ts`,
  or the `/import` page) only inserts/updates rows — it never wipes tables; do not
  write one that does.
- **Schema and migrations** live in `lib/schema.mjs` (shared by the app and
  `scripts/mcp-server.mjs`). Add columns with the `ALTER TABLE` list there.
- **Personal configuration** is `config/owner.json` (gitignored). Never hardcode an
  owner's name, email, practice, or filesystem paths in tracked files — read them
  via `loadOwner()` from `lib/owner.mjs`. Contact and company names belong in the
  database, not in code, prompts, or examples.
- **AI routing:** tool-less "write" steps go through `runModel` (local Ollama, Claude
  CLI fallback only when Ollama is unavailable); steps that need Gmail/Calendar/
  Zoom/Drive/web go through `runClaudeStream` with an explicit read-only tool grant.
  Nothing the models produce is saved without a review step (Intake/Log review
  screens; Coach proposals are ticked to record).
- **Vocabulary** (statuses, buckets, stages, kinds, strengths, cadences) is
  `DEFAULT_VOCAB` in `lib/vocab.mjs`, merged with the gitignored `config/vocab.json`
  (documented by `config/vocab.example.json`). `lib/db.ts` re-exports it as
  `STATUS`/`BUCKETS`/`STAGES`/`KINDS`/`STRENGTHS`/`DEFAULT_CADENCE`, the MCP server
  reads it via `loadVocab(ROOT)`, and prompts build their lists with the helpers
  in `lib/vocab.mjs` (`bucketList(VOCAB)` etc.). Never spell out a list of keys in
  a prompt or a zod enum; colours are palette names mapped to Tailwind classes
  inside `lib/vocab.mjs` (keep those class strings literal).
- **Check before committing:** `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`,
  `npm test` and `node --check scripts/mcp-server.mjs`. The server binds to 127.0.0.1 only.
- **Deploy locally:** `./Stop CRM.command && ./Start CRM.command` (rebuilds when source
  changed) or `npm run build && npm start`.
