### F2-SWEEP · The March residue sweep doubles the gap every time it is re-run · F2 · Severity: High
**What's wrong:** `scripts/reconcile_march.ts` has no run-once guard. Each run posts a fresh correction group per merchant, so running it twice doubles the write-off. That is exactly what Finance saw on staging ("ran it twice ... the gap doubled").

**Why it happens:** `postResidueCorrection` (`scripts/reconcile_march.ts:72-82`) inserts the merchant_payable debit / scheme_rounding_residue credit under `entryGroupId = randomUUID()` (`:74`), so a different id every run. Nothing checks for an earlier sweep, and `ledger_entries` has no unique key that could reject a repeat (0007). The comment directly above (`:71`, "am: re-running is safe, entry_group_id dedupes it") claims the opposite. The log can't tell either: the script prints `toISOString()` (always `Z`), so the "+03:00" timestamp FH quotes (`:92`) did not come from this code path, and a single log line proves nothing.

**What it breaks:** Worked number: a merchant with 17 fils of March residue is debited 17 fils on the first run and 34 on the second. Every extra run takes the residue again from the merchant's payable balance, and the ledger gives no sign of the repeat. Answer to Finance's question "Is it safe to run again?": **before this fix, no**; after it, a re-run posts nothing for merchants already swept.

**Why it needed a fix:** A one-off finance tool that silently doubles a ledger write-off when re-run is a money bug, and F2 says it may already have run more than once in production.

**Fix:** `scripts/reconcile_march.ts`
```diff
-// am: re-running is safe, entry_group_id dedupes it
-async function postResidueCorrection(...)
+// AUDIT (F2): re-running was NOT safe: entry_group_id is a fresh randomUUID per run, so nothing deduped
+export async function postResidueCorrection(...)
   ...
   const description = "March 2026 scheme rounding residue sweep — manual recon per finance";
+  const alreadySwept = await client.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1 AND description = $2 LIMIT 1`, [merchant.merchantId, description]);
+  if (alreadySwept.rowCount) return; // run-once per merchant: a second run posts nothing
```
(`export` only makes the function testable.) Lines: prod +4/−2, test +31/−0.

**Why this is the smallest correct fix:** one existence check at the single place that posts, keyed on what makes a sweep unique (merchant plus the month-specific description). Why not a deterministic entry_group_id? Without a unique index nothing would reject the duplicate, so it would need a new migration too. Why not a unique index on description? It is a schema change for a one-off script.

**Proof:** `scripts/reconcile_march.audit.test.ts` "re-running the March residue sweep posts nothing the second time" fails before (`expected: 1, actual: 2` correction groups) and passes after. With the existing sweep tests: 4/4.

**Regression risk:** a first run behaves as before. Two runs started at the same instant could both pass the check (no lock), which is acceptable for a manual one-off; ADR-0002's residue journal at export (SCHEME-2) removes the need for sweeps altogether. To find past double runs in production: `SELECT merchant_id, count(DISTINCT entry_group_id) FROM ledger_entries WHERE description LIKE 'March 2026 scheme rounding residue sweep%' GROUP BY 1 HAVING count(DISTINCT entry_group_id) > 1;`. Open finance question (not changed): ADR-0002's residue legs run card_scheme_clearing → scheme_rounding_residue, while this script charges the residue to merchant_payable. The month window is also UTC (`monthBounds`), not Bahrain time.

**Trap note:** `:71` "re-running is safe, entry_group_id dedupes it" (false; corrected in place). The header ("Run manually, once") was the only guard.
