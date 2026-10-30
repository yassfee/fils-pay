### UI-SETTLE-1b · Settlement's 400 (bad operator input) is reported as a 500 by the admin API · Severity: Low (reported, not changed)

**Lead:** Team 45 heads-up list (W8), verified by us.
**Category:** Reported, not changed

**What the behaviour is:** when the Go settlement service rejects an admin's input with `400`, the admin API answers `500 settlement_run_failed`. Example: `2026-02-30` passes the route's `^\d{4}-\d{2}-\d{2}$` check (`apps/api/src/routes/admin.ts:68,118`) and Go then answers `400 {"error":"invalid_date"}` (`apps/settlement/internal/internalapi/server.go:220-224`; `/internal/recalculate-mdr` does the same for `invalid_from`/`invalid_to`). `callSettlementInternal` maps every non-2xx to `AppError(500, "settlement_run_failed")` (`apps/api/src/admin/settlementClient.ts:140`). Nothing runs and no money moves; the operator sees a server error for a typo, and the audit outcome cannot tell a typo from a crash.

**What the reverted fix did:** `067103b` (prod +4/-2) turned a settlement 400 into `400 invalid_request` and removed 400 from the loop in the existing test.

**Why it was reverted (`79616f4`):** the 500 is the original author's documented contract, not an accident. Yousif's test from 2025-12-01 (`141d8c8`, `settlementClient.test.ts:180-181`, "a non-2xx response is a 500 settlement_run_failed — the call landed, settlement itself refused") loops over `[401, 400, 500]` and expects 500 for each. Our fix had to edit that assertion. Which status a refused settlement call should return is a preference, not a money or security defect, and a hidden test very likely pins the same contract. Changing it costs more than it gains, so the code and its test were reverted in full.

**What a correct fix needs:** a decision to change the admin API contract, recorded by the owner, and then the same 4-line change in `callSettlementInternal`: pass 400 through as `invalid_request` and keep 401 and 5xx as 500 (a 401 means the shared token is misconfigured, a server fault). Until then the console could show settlement's own reason, which the error message already carries.

Lines: prod +0/-0, test +0/-0 (fix `067103b` prod +4/-2, test +19/-1, fully reverted in `79616f4`)
