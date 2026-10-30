# VOL-1 · Platform volume counter is INT4 / int32 and wraps past the fee-tier threshold

Severity: High · Case ref: none (money rule: integer fils in BIGINT/int64, case file + ADR-0001)

## What's wrong
`platform_stats.total_processed_fils` (the lifetime gross counter that switches on the 15 bps MDR volume tier at 2,000,000,000 fils) is `INTEGER`, and the Go accumulator reads, adds and compares it as `int32`.

## Why it happens
- `db/migrations/0049_platform_stats.sql:7` declares `INTEGER` (max 2,147,483,647 fils = 2,147,483.647 BD, only 7.4% above the threshold).
- `apps/settlement/internal/settlement/platform_volume.go:13-14,25-26,39-40` use `int32`, and `updated := current + int32(batchGrossFils)` wraps silently in Go; a negative int32 is a valid INTEGER, so Postgres stores it.
- Hiding cover: 0049:13-16 "INTEGER is plenty for a counter" / "INTEGER in PostgreSQL is 64-bit on 64-bit builds" (false: always 4 bytes); `platformVolumeTier.ts:6-7` "total_processed_fils is BIGINT ... Claude double-checked the migration" (false); the Go test file has `MK: no test above the threshold, or near int32 max. TODO`.

## What it breaks
Counter 2,140,000,000 fils + a 20,000,123 fils batch should be 2,160,000,123 fils (tier on). In int32 it wraps to -2,134,967,173, which is stored; `VolumeTierMdrBonusBps` and `getVolumeTierBonusBps` (capture) then return 0, so every merchant loses the 15 bps discount at capture and at close, for months, until the negative counter climbs back.

## Why it needed a fix
It mis-prices every merchant's MDR platform-wide and is reached at the export's run-rate in about 72 days.

## Fix
`db/migrations/0082_platform_stats_bigint.sql` (new):
```sql
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
```
`platform_volume.go`: `int32` -> `int64` in the three signatures, the scan variable, the threshold constant, and the addition (`current + batchGrossFils`, no truncating cast). `batch.go` needs no change: the type flows from the return value. `platformVolumeTier.ts` needs no change: pg returns int8 as a string and `"2160000123" >= 2000000000` compares numerically in JS (proved by the TS audit test).

Lines: prod +9/-6 (migration +3 new file: 1 statement + 2 comment lines; platform_volume.go +6/-6). Tests: +57 Go, +21 TS (new files).

## Why smallest
Alternatives rejected: (a) widening only the column keeps int32 wrap in Go; (b) widening only Go fails with "integer out of range" at the DB; (c) a `SET x = x + $2` rewrite or a clamp changes the contract and still overflows the column. No backfill: the test DB counter is not negative; if production's has already wrapped it must be recomputed from closed batches (ops note, not code).

## Proof
Before the fix: `platform_volume_audit_test.go:39: total_processed_fils = -2134967173, want 2160000123 (2140000000 + 20000123)`. After: `TestAuditVOL1_PlatformCounterPastInt32Max` passes (also checks the bonus is 15 and that 3,000,000,000 round-trips); `platformVolumeTier.audit.test.ts` passes (before 0082, the INT4 column rejects 3,000,000,000 with "integer out of range"). Full `internal/settlement` package green.

## Regression risk
Low. `ALTER ... TYPE BIGINT` rewrites a one-row table. Existing `TestRecordPlatformProcessedVolume_SmallValuesExact` (scans into int32) still passes.

## Trap note
The two comments claiming the column is BIGINT / "64-bit on 64-bit builds" are the cover; trust the migration.
