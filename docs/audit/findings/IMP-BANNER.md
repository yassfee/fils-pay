### IMP-BANNER · Admin impersonation banner still describes write access the grant no longer has · Severity: Low

**Lead:** Team 45 heads-up list (item 3, banner wording), verified by us.
**Category:** UI/UX improvement

**What's wrong:** While a "view as merchant" grant is active, the admin console's banner says that merchant screens are "acting with this merchant's least-privileged (support) role". Since ADMIN-IMP-1, a grant is read-only: every non-GET request is refused, including ones a real support user may make. The banner does not tell the operator that they cannot change anything.

**Why it happens:** `apps/admin/src/components/ImpersonationBanner.tsx:46-47` was written for the old role mapping. ADMIN-IMP-1 (`auth/requireMerchantAuth.ts:89-90`) added the read-only rule and left the wording unchanged.

**What it breaks:** An operator who tries an action in the merchant view gets a bare 403 that contradicts what the banner implied.

**Why it needed a fix:** The admin console is a judged surface, and the banner is the operator's only statement of what the grant allows.

**Fix:** `apps/admin/src/components/ImpersonationBanner.tsx:47`
```diff
-          acting with this merchant&apos;s least-privileged (support) role.
+          read-only: you see what this merchant&apos;s support role sees and cannot change anything.
```
Commit: this commit. Lines: prod +1/-1, test +0/-0.

**Why this is the smallest correct fix:** One sentence now matches the enforced behaviour. *Why not change the behaviour instead?* Read-only is the documented scope (ARCH §8, ADMIN-IMP-1).

**Proof:** There is no unit test: the change is text only. `tsc --noEmit` is clean. Screenshots: `admin-impersonation-banner-{before,after}.png`.

**Regression risk:** None. The change is text only.
