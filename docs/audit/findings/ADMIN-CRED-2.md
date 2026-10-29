### ADMIN-CRED-2 · Credit maker-checker compares display names instead of admin user ids · H3 · Severity: High

**What's wrong:** The two-person control on above-threshold credits checked whether the approver's display name differed from the requester's, not whether the two were the same admin user.

**Why it happens:** `apps/api/src/admin/creditApproval.ts:11` read `if (approver.displayName === requester.displayName)`. The caller (`admin/credits.ts:326-329`) passes both `adminUserId`s, built from `credit_requests.requested_by_admin_user_id` and the approver's session (`routes/adminCredits.ts:102`), but the check ignored them. The assumption behind it, "display names are unique per admin" (0060 AM note), is false: `admin_users.display_name` has no UNIQUE constraint (`0031`).

**What it breaks:** (a) Self-approval: finance admin Huda requests a 120,000 fils credit, her display name is changed from "Huda (Finance)" to "Huda (Admin)", and she approves her own request. The names differ, so the credit posts with one person involved. (b) False block: two different finance admins both named "Ahmed A." can never approve each other's credits.

**Why it needed a fix:** H3 says admin actions lack the right role checks. Maker-checker is the control on large money-out credits, and with this bug it can be bypassed by anyone able to edit a display name.

**Fix:** `apps/api/src/admin/creditApproval.ts:11`
```diff
-  if (approver.displayName === requester.displayName) {
+  if (approver.adminUserId === requester.adminUserId) { // ADMIN-CRED-2 (H3): compare identities, never display names
```
Commit: this commit. Lines: prod +1/-1, test +21/-1 (new audit test plus the corrected false comment).

**Why this is the smallest correct fix:** This is the single comparison that defines two-person control, and both ids are already in the `CreditActor` values passed to it. The signature, the error code and the caller are unchanged. *Why not also add a DB CHECK (`approved_by IS DISTINCT FROM requested_by`)?* It is defence in depth that adds a migration and does not change behaviour once the code is correct. It is noted here as optional.

**Proof:** `ADMIN-CRED-2: the same admin under a different display name cannot approve their own credit` fails before the fix (`assert.throws` → "Missing expected exception"). `ADMIN-CRED-2: two different admins who share a display name may approve each other` fails before the fix (`assert.doesNotThrow` → "Got unwanted exception... self_approval_forbidden"). Both are in `apps/api/src/admin/creditApproval.audit.test.ts` and pass after the fix.

**Regression risk:** Existing self-approval tests use the same actor object (same id), so they still throw. `admin/creditApproval.test.ts`, `admin/credits.test.ts` and `routes/adminCredits.test.ts` pass (25/25 including the audit tests).

**Trap note:** `admin/creditApproval.test.ts:20` (FH: "added a same-id/different-name case ... it passes, so ids are covered too") was false, because no such case existed. It is corrected to point at the audit test. The poisoned `AGENTS.md` and the `0060:69-70` note ("display names are unique per admin") are outside this lane's owned files.
