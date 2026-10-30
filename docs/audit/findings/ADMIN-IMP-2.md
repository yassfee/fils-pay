### ADMIN-IMP-2 · Impersonation grants survive admin disable and logout · H3 · Severity: Medium

**What's wrong:** a "view as merchant" grant kept resolving after its admin was disabled and after the admin logged out. Disabling an admin kills their admin sessions, but their `fp_impersonation` cookie still opened the merchant's dashboard until the grant expired, and `IMPERSONATION_TTL_MINUTES` has no upper bound.

**Why it happens:** `apps/api/src/admin/impersonation.ts:117-123` (`lookupImpersonationGrant`) checks `revoked_at`, `ended_at` and `expires_at`, but not `admin_users.status`, unlike `lookupAdminSession` (`adminAuth/sessions.ts:127`, `AND au.status = 'active'`). No code ever sets `revoked_at`. Logout (`routes/adminAuth.ts:209`) calls only `revokeAdminSession`, which revoked the session row alone. The faulty assumption is in the comment at `impersonation.ts:105`: "FH: revoked_at gets set by the admin-disable trigger, so it's covered". No such trigger exists in any migration (the only triggers are the ledger-balance one in 0007 and the outbox-notify one in 0021). `routes/admin.ts:328` (YA) already flagged it: "disabled admins' grants keep working until they expire ... FP-238".

**What it breaks:** an admin is disabled for misconduct, or forgets to end a view on a shared machine and logs out. Either way, whoever holds the cookie keeps reading that merchant's transactions, customers' references and payouts until the grant expires. ADMIN-IMP-1 already limits a grant to read-only, so the exposure is data, not money.

**Why it needed a fix:** revoking an admin's access must revoke all of it (H3: admin actions without the right role checks). A disabled identity must not keep a back door into a merchant's data.

**Fix:** `apps/api/src/admin/impersonation.ts:104,122` and `apps/api/src/adminAuth/sessions.ts:89-94`
```diff
-// no admin_users.status check here ... — am
-// FH: revoked_at gets set by the admin-disable trigger, so it's covered
+// ADMIN-IMP-2: no admin-disable trigger exists; the status check below ends a disabled admin's grants (logout: revokeAdminSession)
-        AND g.expires_at > now()`,
+        AND g.expires_at > now()
+        AND au.status = 'active'`,
```
```diff
   await client.query(`UPDATE admin_sessions SET revoked_at = now() WHERE id = $1`, [adminSessionId]);
+  // ADMIN-IMP-2: logout also ends the admin's open grants (a pending, pre-OTP session never had any)
+  await client.query(
+    `UPDATE admin_impersonation_grants SET revoked_at = now() WHERE revoked_at IS NULL AND ended_at IS NULL
+        AND admin_user_id = (SELECT admin_user_id FROM admin_sessions WHERE id = $1 AND authenticated)`,
+    [adminSessionId],
+  );
```
Lines: prod +9/-3 (code +7/-1, comments +2/-2), test +31/-0.

**Why this is the smallest correct fix:** *Disable:* one predicate in the only lookup every grant passes through, mirroring `lookupAdminSession`. It covers every disable path (route, SQL, future tooling) with no trigger or migration. *Logout:* `revokeAdminSession` is the function the logout route calls, and the route file belongs to another lane. Its other caller is the OTP lockout of a pending session (`routes/adminAuth.ts:150`), and the `AND authenticated` guard keeps that path from touching grants, so a failed OTP cannot end a live admin's views. Finally, the grant gets `revoked_at` set, the column built for this and not used until now. *Why not a DB trigger on `admin_users.status`?* That needs a new migration and more lines, and it does not cover logout. *Why not bind grants to a session id?* That needs a schema change.

**Proof:** `ADMIN-IMP-2: a grant stops resolving once its admin is disabled or logs out` (`apps/api/src/admin/impersonation.audit.test.ts`) failed before the fix with "a disabled admin's grant still resolves". After the fix, both the disabled and the logged-out admin's grants return `null`, and a fresh grant still resolves.

**Regression risk:** logging out of one admin session now ends that admin's grants opened from any session. That is the safe side, since grants are per admin and not per session. `routes/admin.test.ts` (impersonation start/end/expiry tests) and `routes/adminAuth.audit.test.ts` pass (46/46 with the new test). The stale YA question at `routes/admin.ts:328` is now answered by this note. That file is in another lane and is left unchanged.

**Trap note:** the FH comment pointed to an "admin-disable trigger" that does not exist, and `adminAuth.ts:34` ("status disabled ... kills existing sessions") is true for sessions only.
