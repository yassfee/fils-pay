### TEST-BACKOFF · Dispatcher backoff test asserts an exact value from a jittered function · baseline test failure · Severity: Low

**What's wrong:** `dispatcher.test.ts` "failing endpoint: backoff/exhaustion sequence …" asserted `backoffDelayMs(1, config) === 1000` (and `=== 2000` for attempt 2) without passing a jitter source, so it fails roughly every run (actual 925, 1052, 939, 1073 …).

**Why it happens:** `apps/api/src/webhooks/dispatcher.ts:55-63` applies a documented ±10 % jitter that defaults to `Math.random`. The code is correct; the test is wrong (it ignores the injectable `jitter` parameter it was designed with).

**What it breaks:** Only CI signal: a permanently red test masks real dispatcher regressions.

**Why it needed a fix:** A flaky/always-failing test is ignored, which is how bugs like CW-3 stayed hidden.

**Fix:** `apps/api/src/webhooks/dispatcher.test.ts:200,220`: `backoffDelayMs(n, config)` → `backoffDelayMs(n, config, () => 0.5)` (jitter midpoint = factor 1.0). The live `next_attempt_at` checks keep their 3000 ms tolerance, which already covers ±10 %. Commit: this commit. Lines: prod +0/-0, test +2/-2.

**Why this is the smallest correct fix:** Two arguments in the test; removing jitter from production would be a behaviour change that the design (and thundering-herd protection) does not want.

**Proof:** before: `AssertionError: expected 1000, actual 925`; after: `dispatcher.test.ts` 8/8 pass.

**Regression risk:** none (test-only).

**Trap note:** the assertion looked like a spec of "base delay = 1000 ms" but silently depended on `Math.random() === 0.5`.
