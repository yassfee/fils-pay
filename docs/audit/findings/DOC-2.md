### DOC-2 · The seed truncates every merchant, the append-only ledger and all admin users of whatever database it is pointed at, while the runbook calls it safe on shared staging · (no case ref; data loss) · Severity: Medium (reported, not changed)

**Lead:** Team 45 heads-up list (B4d), verified by us.

**What's wrong:** `npm run seed` runs `TRUNCATE TABLE ledger_entries, scheme_export_lines, outbox_events, holds, settlement_batches, transactions, merchant_users, merchants, …, admin_users RESTART IDENTITY CASCADE` against `DATABASE_URL`, with no check of what that database is. The note next to it (`db/seed/generate.ts:210-211`, AM: "only touches the fixture tables … safe to run against a shared/staging database") and `docs/RUNBOOK.md:134-137` ("It won't touch other tables, so it's safe against a shared staging database") are false: the listed tables are every merchant, every transaction and the whole ledger, and `CASCADE` sweeps every table that references them (sessions, API keys, payment links, webhooks, refunds, credit requests, admin sessions and the admin audit log).

**Why it happens:** `db/seed/generate.ts:110-140` lists the core tables themselves, not fixture rows, and `:212` truncates them with `CASCADE`. `db/seed/index.ts:14-17` only checks that `DATABASE_URL` is set. The append-only protections do not help: `0084_ledger_entries_append_only.sql:3` and `0102_admin_audit_log_append_only.sql:4` both state that `TRUNCATE` "is not a row operation and is unaffected".

**What it breaks:** one mistyped `DATABASE_URL` (the RUNBOOK's own AM note: "staging-2 got reset this way") destroys all merchant, ledger and audit data of that database without a prompt, which no append-only trigger can prevent.

**Why it needed a fix:** a script that erases the ledger of an arbitrary database is a data-loss hazard, and the two places an operator reads before running it say the opposite.

**Fix:** not changed. The seed is used to reset the live demo box, so its behaviour stays as it is. The guard we would add, at the top of `generate()` before `BEGIN` (about 3 lines):
```ts
const { rows } = await client.query<{ n: string; db: string }>(`SELECT count(*) AS n, current_database() AS db FROM merchants`);
if (Number(rows[0]!.n) > 0 && process.env.SEED_CONFIRM_WIPE !== rows[0]!.db)
  throw new Error(`seed: ${rows[0]!.n} merchants exist in ${rows[0]!.db}; set SEED_CONFIRM_WIPE=${rows[0]!.db} to wipe them`);
```
An empty database (fresh install, CI) seeds as today; a populated one needs the operator to type the database name. The RUNBOOK sentence would change to say the seed wipes all merchant, ledger and admin data.

**Why this is the smallest correct fix:** one check before the single `TRUNCATE`, keyed to the database's own name so a wrong `DATABASE_URL` cannot pass by accident. *Why not truncate only seed-owned rows?* Rewriting the reset as per-row deletes would fight the append-only ledger trigger (0084) and change what the demo reset produces.

**Proof:** reading `db/seed/generate.ts:110-140` and `:212`: `merchants`, `transactions`, `ledger_entries` and `admin_users` are in the `TRUNCATE` list, and the migrations quoted above confirm `TRUNCATE` bypasses the append-only triggers. Not executed against any database.

**Regression risk (of the proposed guard):** the demo-box reset would need `SEED_CONFIRM_WIPE=<db name>` added to its command.

Lines: prod +0/-0 (proposed +3), test +0/-0
