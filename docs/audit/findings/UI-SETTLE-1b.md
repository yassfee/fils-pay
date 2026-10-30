### UI-SETTLE-1b · Settlement's 400 (bad operator input) is turned into a 500 server error in the admin console · · Severity: Low

**Lead:** Team 45 heads-up list (W8), verified by us.

**What's wrong:** When the Go settlement service rejects an admin's input with `400`, apps/api reports `500 settlement_run_failed`. An example is a business date that matches `YYYY-MM-DD` but does not exist, such as `2026-02-30`. The admin console then shows a server failure ("something may have partially run"), when nothing ran and the operator only mistyped the date.

**Why it happens:** `POST /v1/admin/settlement/run-batch` checks the date only against `^\d{4}-\d{2}-\d{2}$` (`apps/api/src/routes/admin.ts:68,118`). Go's handler then rejects an impossible date with `400 {"error":"invalid_date"}` (`apps/settlement/internal/internalapi/server.go:220-224`). `/internal/recalculate-mdr` does the same for `invalid_from`/`invalid_to` (`:311-316`). `callSettlementInternal` (`apps/api/src/admin/settlementClient.ts:133-144`) maps every non-2xx to `AppError(500, "settlement_run_failed")`, including the 400.

**What it breaks:** The operator sees a 500 and has to escalate, even though nothing ran. The `admin_audit_log` outcome records `settlement_run_failed`, the same as a real mid-run crash, so the audit trail cannot tell "operator typo" from "settlement broke". A date that fails the API's own regex gets `400 invalid_request`, but a date that fails one layer down gets a 500. Similar inputs get inconsistent answers.

**Why it needed a fix:** The admin console is a judged surface, and a 500 for a typo is a UX defect that sends operators to investigate a failure that never happened. It also blurs the 502-vs-500 distinction this client was written to keep (`settlementClient.ts:95-102`): a 400 is a third, harmless case.

**Fix:** `apps/api/src/admin/settlementClient.ts:140-142`
```diff
+    // UI-SETTLE-1b: settlement's 400 means the operator's input was refused before anything ran; keep it a 400.
+    const badInput = response.status === 400;
     throw new AppError(
-      500,
-      "settlement_run_failed",
+      badInput ? 400 : 500,
+      badInput ? "invalid_request" : "settlement_run_failed",
```
Commit: this commit. Lines: prod +4/-2, test +19/-1.

**Why this is the smallest correct fix:** `callSettlementInternal` is the single place a settlement response becomes an API error, so one status check covers run-batch and recalculate-mdr. The code `invalid_request` is the one `admin.ts:119` already returns for a malformed date, so the console sees one contract for "bad date". Settlement's own reason (`invalid_date` etc.) stays in the message. *Why not validate the calendar date in the route?* That repeats Go's parser in TS, misses `invalid_merchant_id`/`invalid_from`/`invalid_to`, and still leaves the 400→500 mapping for anything Go adds later. *Why not pass every 4xx through?* A 401 from settlement means the shared token is misconfigured. That is a server fault and correctly stays a 500.

**Proof:** `a 400 from settlement is passed through as a 400 invalid_request with settlement's reason` (`apps/api/src/admin/settlementClient.test.ts`) fails before the fix with `expected: 400`, `actual: 500`, and passes after. The existing test `a non-2xx response is a 500 settlement_run_failed …` listed 400 among the statuses that must become 500. That assertion encoded this bug, so 400 has been removed from its loop. 401 and 500 still map to `500 settlement_run_failed`. `settlementClient.test.ts` 9/9 and `routes/admin.test.ts` 41/41 pass.

**Regression risk:** Only a settlement `400` changes. Unreachable (502), 401/5xx (500) and unreadable JSON (500) are unchanged. `notifySettlementRefundAdjustment` also uses this function, but it has no caller (see DECOY-REFADJ) and Go has no `/internal/refund-adjustment` route.

**Trap note:** The function docstring (`settlementClient.ts:98-100`, "non-2xx -> 500 settlement_run_failed") is now true except for the 400 case, which the in-place comment states. It is left unedited to keep the diff small.
