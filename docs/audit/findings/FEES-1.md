### FEES-1 · An unapproved platform-wide 15 bps volume-tier discount is live in capture (open policy question for finance) · F6 (fee shown vs charged) · Severity: Medium (reported, not changed)
**Category:** Reported, not changed

**Status:** Open policy question for finance. No code change, by decision: changing it would move every fee, ledger leg, payout and demo figure once the tier is reached, and nothing in the case file says which way finance wants it.

**What's wrong:** Once `platform_stats.total_processed_fils` reaches 2,000,000,000 fils (2,000,000.000 BD), every capture for every merchant is charged 15 bps less: `capture.ts` books the fee at `effective rate - 15`. Nobody has documented approval for this discount. The original developer explicitly refused it: "Huda floated a platform-wide discount once total volume passes a threshold. I said no until finance signs off in writing" (`docs/HANDOVER.md:38-39`). No sign-off exists in the repo.

**Why it happens:** `apps/api/src/payments/capture.ts:175` reads `getVolumeTierBonusBps(client)`, and `:203` books `applyRateFils(requestedAmount, Math.max(0, effectiveMdrBps - volumeTierBonusBps))`. `apps/api/src/fees/platformVolumeTier.ts:5,8,29` defines the 2,000,000,000 fils threshold and the 15 bps bonus. The counter is fed by every batch close (`apps/settlement/internal/settlement/batch.go`, `RecordPlatformProcessedVolume`). Since FEES-5, settlement charges the fee capture booked, so the tier reaches payouts through the ledger. The Go-side `VolumeTierMdrBonusBps` (`platform_volume.go:39`) is no longer used for pricing.

**What it would break (once the counter passes the threshold):** a 100.000 BD capture at a 225 bps schedule books 2,100 fils instead of 2,250 fils, for every merchant, with no notice. The dashboard rate (`merchants.mdr_bps` or the schedule) no longer matches what is charged, the same "shown vs charged" gap as case file F6. Today the counter is far below the threshold: the seed starts it at 0 (`db/seed/generate.ts:832`), so demo and test numbers are unaffected.

**Evidence and misleading cover:**
- `platformVolumeTier.ts:3` says "threshold updated in the Aug dependency bump, approved by finance — am".
- `platformVolumeTier.ts:4` answers "MK: which finance ticket? cant find one. Huda didnt know about it when i asked".
- `CHANGELOG.md:10-11` (1.9.2) says "Volume-tier threshold updated for the platform-wide discount (d69a813). No pricing change for existing merchants". No commit `d69a813` exists in the repository, and the tier changes every merchant's price once reached.
- The case file and ADR-0001/0002 say nothing about a volume tier.

**What we would do, once finance decides:**
- *Not approved* (the handover's default): make `getVolumeTierBonusBps` return 0, or remove the subtraction at `capture.ts:203`; one line. Keep the counter, which VOL-1 made BIGINT/int64 so it cannot wrap.
- *Approved:* keep it, record the sign-off, and show the discounted rate wherever the fee is displayed (F6), so the dashboard and the ledger agree.

**Related:** VOL-1 (counter overflow, fixed). FEES-5 (settlement now charges the booked fee, so TS and Go can no longer disagree on the tier). ADMIN-CRED-4 (credit reversals do not apply the tier).

Lines: prod +0/-0, test +0/-0 (open finding, documentation only)
