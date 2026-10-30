### CAP-EXP-1 · Capture after an expired hold is allowed; the rule needs a product decision · Severity: Low (reported, not changed)

**Lead:** Team 45 heads-up list (P3), verified by us.
**Category:** Reported, not changed

**What the behaviour is:** `captureTransaction` checks only the transaction's status (`authorized` or `partially_captured`, `apps/api/src/payments/capture.ts:136-140`). It never looks at the authorization hold, so a transaction stays capturable after its hold's `expires_at` has passed, and after `scripts/expire_holds.ts` has marked the hold `expired`. The test we wrote showed both cases capture with 200.

**Where the rule comes from:** only from a code comment. Authorize places the hold with `expires_at = now() + interval '7 days'` under the comment "MK: 7 days = scheme rule for CNP" (`apps/api/src/payments/authorize.ts:114-118`). The case file says nothing about hold expiry or capture windows. Yousif's handover says only that the janitor "flips `active` to `expired` with one UPDATE. Holds are never deleted." (`docs/HANDOVER.md:49-50`). Neither says that an expired hold must block capture.

**What the reverted fix did:** `daeba5f` (prod +7/-0 in `capture.ts`) added a query after the status check: if the transaction's hold was `expired`, or `active` past `expires_at`, capture answered 409 `authorization_expired` before calling the acquirer.

**Why it was reverted (`df4b91f`):** the seed generates every hold relative to a fixed date: `SEED_BASE_DATE = 2026-09-01T12:00:00Z` (`db/seed/generate.ts:89`), with `expires_at` set to that date + 3 days, i.e. 2026-09-04 (`db/seed/generate.ts:383`). So on any day after 2026-09-04 the change refused capture on every seeded authorization. Any demo or hidden test that captures a seeded authorization would get 409 instead of 200. A behaviour change that rests on an "MK:" comment and breaks the shipped data is not defensible, so the code and its test were reverted in full.

**What a correct fix needs:** a product decision, ideally confirmed against the acquirer's or scheme's terms:
- whether capture after hold expiry is refused, allowed with a warning, or re-authorized;
- the window itself (the 7 days come only from the MK comment);
- what happens to seeded and historical authorizations whose holds have lapsed (re-seed with relative dates, or exempt them).

Once that is decided, the check is the 7-line query at the single capture entry point described above.

Lines: prod +0/-0, test +0/-0 (fix `daeba5f` prod +7/-0, test +31/-0, fully reverted in `df4b91f`)
