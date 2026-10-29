### MIG-1 · A fresh database cannot be built: migrations 0054/0055 abort · FP-300 (☐1, ☐6), F4 · Severity: High
**What's wrong:** `npm run migrate` on an empty Postgres stops after 51 of 66 files, so a new environment never gets the schema from 0054 onward, including the whole refund schema (0070-0072) that FP-300 needs.

**Why it happens:** both files were written on the abandoned `settlement-v2` branch against v2 tables and landed on `main` without ever running. `0054_views.sql` defines `v_unbatched_capture_events` over `settlement_batch_events`, a table that does not exist. `0055_chart_of_accounts_suspense.sql` inserts into `chart_of_accounts (code, name, account_type, description)` with kind `'suspense'`, but 0007's table is `(id, name, kind CHECK (kind IN ('asset','liability','revenue')))`. The runner (`db/migrate.ts`) wraps each file in a transaction and aborts on the first error. Runtime errors, verbatim: `migrate: failed applying 0054_views.sql: relation "settlement_batch_events" does not exist` and `ERROR: column "code" of relation "chart_of_accounts" does not exist`.

**What it breaks:** `docker compose up` (the case file's own instructions) produces a database with no refund tables and no `merchant_payable_position` view, which the settlement balance code reads (`apps/settlement/internal/ledger/refresh.go:26,62`). Eleven existing refund tests could never run: once it was fixed, they ran and exposed REF-4.

**Why it needed a fix:** nothing can be deployed (box ☐6) or tested on a clean database, and FP-300 has no schema.

**Fix:** in place (the only allowed exception to "never edit an applied migration").
```diff
-- 0054: AND NOT EXISTS (SELECT 1 FROM settlement_batch_events sbe WHERE sbe.transaction_event_id = te.id);
+- 0054: AND te.settlement_batch_id IS NULL;            -- the v1 meaning of "not yet batched" (0023)
-- 0055: INSERT INTO chart_of_accounts (code, name, account_type, description) ... 'suspense' ... ON CONFLICT (code)
+- 0055: INSERT INTO chart_of_accounts (id, name, kind) ... 'asset' ... ON CONFLICT (id)   -- descriptions kept as comments
```
Lines: SQL +7/−9, test +0/−0. Commit 197c3e2.

**Why this is the smallest correct fix:** two statements repaired where they fail. Why in place and not a later corrective migration: the runner aborts at 0054, so a later file could never be reached, and no database ever ran 0054-0056 (Yousif, `docs/HANDOVER.md:70`), so no applied history diverges. The runner stores no checksum, despite the MK comment in `db/migrate.ts`. Why kind `'asset'` and not a new `'suspense'` kind: 0007 already types the existing suspense account `scheme_rounding_residue` as `'asset'`, and nothing reads `kind`; adding a kind would be a schema change with no effect.

**Proof:** fresh database: before, abort at 0054 after 51 files; after, `migrate: 66 migration(s) applied` (now 73 with our new migrations, 0001-0098). Verified again on several fresh test databases and in the compose stack.

**Regression risk:** none for existing databases (they never applied these files).

**Trap note:** ADR-0005 says 0054-0056 are "reserved" and "not merged", yet they were on `main`. MK's HANDOVER note ("0054 ran on staging-2 ... I'm fairly sure") contradicts Yousif's own line and was not trusted.
