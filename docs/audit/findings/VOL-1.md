### VOL-1 · Platform volume counter `total_processed_fils` is INTEGER / int32, against ADR-0001's BIGINT rule, and silently wraps negative · ADR-0001 · Severity: Medium
**Category:** Bug

**What's wrong:** `platform_stats.total_processed_fils`, the lifetime gross fils settled through `CloseBatch`, is an `INTEGER` column, and the Go accumulator reads, adds and compares it as `int32`. ADR-0001 rule 1 says every monetary value is integer fils and "Columns end in `_fils` and are `BIGINT`"; rule 2 says Go uses `money.Fils` (`int64`). This column and its Go code break both rules.

**Why it happens:**
- `db/migrations/0049_platform_stats.sql:7` declares `INTEGER` (max 2,147,483,647 fils = 2,147,483.647 BD).
- `apps/settlement/internal/settlement/platform_volume.go` (before the fix) used `int32` for the read, the write and the threshold, and `updated := current + int32(batchGrossFils)` wraps silently in Go. A negative int32 is a valid INTEGER, so Postgres stores it without an error.
- Yousif's handover line says "`platform_stats.total_processed_fils` is INTEGER, which is fine while it's only a counter" (`docs/HANDOVER.md:40-41`). We follow ADR-0001 over that remark. The ADR is the platform-wide money rule and names no exception for counters, the column is a fils amount by name and content, and even a pure counter must not wrap into a negative fils figure.
- Hiding cover: 0049:13-16 ("INTEGER is plenty for a counter" / "INTEGER in PostgreSQL is 64-bit on 64-bit builds", which is false: it is always 4 bytes); `apps/api/src/fees/platformVolumeTier.ts:6-7` ("total_processed_fils is BIGINT ... Claude double-checked the migration", also false); the Go test file carried `MK: no test above the threshold, or near int32 max. TODO`.

**What it breaks:** a counter at 2,140,000,000 fils plus a 20,000,123 fils batch should be 2,160,000,123 fils. In int32 it wraps to −2,134,967,173, and that value is stored. At the September run-rate in `docs/exports/settlement-batches-2026-09-01_20.csv` (592,982.202 BD gross over 20 business days, about 29,649 BD/day) a counter starting at zero reaches the int32 limit in about 72 days. From then on the platform's lifetime volume figure is negative and meaningless. Its only production reader is the capture-time volume-tier lookup (`platformVolumeTier.ts:25-28`, called from `capture.ts:169`); since FEES-5, settlement no longer prices off it. That tier is itself unapproved (FEES-1, reported, not changed), so this note does not rest on the tier's pricing. While the tier code stays live, though, the wrap would also switch its discount off platform-wide.

**Why it needed a fix:** ADR-0001 makes BIGINT/int64 the type for every fils value, so a wrapping money counter is a defect whether or not anything prices off it. Severity is Medium, not High: the counter is reachable at real volume and fails silently, but its pricing consequence depends on the unapproved tier (FEES-1).

**Fix:** `db/migrations/0082_platform_stats_bigint.sql` (new):
```sql
ALTER TABLE platform_stats ALTER COLUMN total_processed_fils TYPE BIGINT;
```
`platform_volume.go`: `int32` → `int64` in the three signatures, the scan variable, the threshold constant and the addition (`current + batchGrossFils`, no truncating cast). `batch.go` needs no change, because the type flows from the return value. `platformVolumeTier.ts` needs no change either: pg returns int8 as a string, and `"2160000123" >= 2000000000` compares numerically in JS (proved by the TS audit test).

Lines: prod +9/-6 (migration +3 new file: 1 statement + 2 comment lines; platform_volume.go +6/-6). Tests: +57 Go, +21 TS (new files).

**Why this is the smallest correct fix:** it changes the column type and the Go type, the two places that break ADR-0001, and nothing else. Alternatives rejected: (a) widening only the column keeps the int32 wrap in Go; (b) widening only Go fails with "integer out of range" at the DB; (c) a `SET x = x + $2` rewrite or a clamp changes the contract and still overflows the column. No backfill: the test DB counter is not negative. If production's has already wrapped, it must be recomputed from closed batches (an ops note, not code).

**Proof:** before the fix: `platform_volume_audit_test.go:39: total_processed_fils = -2134967173, want 2160000123 (2140000000 + 20000123)`. After: `TestAuditVOL1_PlatformCounterPastInt32Max` passes (it also checks that 3,000,000,000 round-trips); `platformVolumeTier.audit.test.ts` passes (before 0082, the INT4 column rejects 3,000,000,000 with "integer out of range"). The full `internal/settlement` package is green. Commit `43e737e`.

**Regression risk:** Low. `ALTER ... TYPE BIGINT` rewrites a one-row table. The existing `TestRecordPlatformProcessedVolume_SmallValuesExact` (which scans into int32) still passes.

**Trap note:** the two comments claiming the column is BIGINT, or that INTEGER is "64-bit on 64-bit builds", are the cover; the migration is the truth. Yousif's "fine while it's only a counter" is an honest judgement call, but ADR-0001 governs it.
