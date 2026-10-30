### LED-1 · The ledger can be edited and deleted as long as each group still balances · F2 · Severity: Medium
**What's wrong:** `ledger_entries` accepts UPDATE and DELETE. Nothing stops someone from rewriting history: scaling a whole posting ×10, back-dating it, or deleting it.

**Why it happens:** `db/migrations/0007_ledger_double_entry.sql:38-70` installs one deferred trigger that only checks that each entry group still nets to 0. Its comment (`:72-74`) claims "Immutability: ... an edited or removed leg unbalances its group ... No separate reject trigger or REVOKE is needed". That is true for one leg, false for a whole group: multiply both legs by 10, or delete both, and the group still balances, so the commit succeeds.

**What it breaks:** the ledger is the source of truth that BAL-1, reconciliation and the payout netting rely on. F2 (the March sweep "ran twice ... the gap doubled", with "the log file only has one timestamp") is the kind of problem an append-only ledger turns from silent to impossible. Worked example (from the test): a balanced 1,000-fil group rewritten to 10,000 fils committed without error.

**Why it needed a fix:** a financial ledger whose rows can be rewritten cannot prove anything to finance or auditors.

**Fix:** new migration `db/migrations/0084_ledger_entries_append_only.sql`: a `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger that raises "ledger_entries is append-only: post a compensating entry instead". Lines: SQL +11 (6 code, 5 comment/blank), test +44.

**Why this is the smallest correct fix:** one trigger at the table, independent of every caller. No application code or test updates or deletes ledger rows (repo-wide grep), and TRUNCATE (dev seed) is not a row operation. Why not REVOKE UPDATE/DELETE: every service connects as the table owner (single DB role in compose), and owners bypass grants.

**Proof:** `scripts/ledger_append_only.audit.test.ts` "ledger entries are append-only: balanced edits and deletes are rejected": before `Missing expected rejection: UPDATE ledger_entries SET amount_fils = amount_fils * 10 ...`; after both statements are rejected (run in rolled-back savepoints).

**Regression risk:** the only writer that updated ledger rows was the FP-300 demo's labelled "DEMO-ONLY" back-dating step (`ops/demo.sh`), which now disables and re-enables this trigger around that one statement, in plain sight. Fixing a wrong posting now requires a compensating group, which is the documented accounting rule.

**Trap note:** the "Immutability" comment in 0007 (`:72-74`) is false for whole-group edits. 0007 is an applied migration, so the comment is left in place and corrected here.
