package settlement

import (
	"context"
	"testing"
)

// TestAuditVOL1_PlatformCounterPastInt32Max: the platform volume counter
// must hold values above 2^31-1 fils (2,147,483.647 BD) and keep the
// volume-tier bonus on. Money is integer fils in BIGINT/int64 (case file;
// ADR-0001). Before the fix the INT4 column and int32 arithmetic wrapped
// 2,140,000,000 + 20,000,123 to -2,134,967,173 and switched the tier off.
func TestAuditVOL1_PlatformCounterPastInt32Max(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	resetPlatformStats(t, pool)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 2140000000 WHERE id = 1`); err != nil {
		t.Fatalf("seed counter: %v", err)
	}
	current, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("ReadAndLockPlatformProcessedFils: %v", err)
	}
	if err := RecordPlatformProcessedVolume(ctx, tx, current, 20_000_123); err != nil {
		t.Fatalf("RecordPlatformProcessedVolume: %v", err)
	}
	var got int64
	if err := tx.QueryRow(ctx, `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&got); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if got != 2_160_000_123 {
		t.Fatalf("total_processed_fils = %d, want 2160000123 (2140000000 + 20000123)", got)
	}
	after, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil {
		t.Fatalf("re-read: %v", err)
	}
	if bps := VolumeTierMdrBonusBps(after); bps != 15 {
		t.Fatalf("VolumeTierMdrBonusBps(%d) = %d, want 15 (above the 2,000,000,000 fils threshold)", after, bps)
	}

	// A value above 2^31 written directly must round-trip unchanged.
	if _, err := tx.Exec(ctx, `UPDATE platform_stats SET total_processed_fils = 3000000000 WHERE id = 1`); err != nil {
		t.Fatalf("store 3,000,000,000 fils: %v", err)
	}
	big, err := ReadAndLockPlatformProcessedFils(ctx, tx)
	if err != nil || int64(big) != 3_000_000_000 {
		t.Fatalf("read 3,000,000,000 fils: got %d, err %v", big, err)
	}
}
