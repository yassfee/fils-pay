package scheduler

import (
	"context"
	"testing"
	"time"
)

// SCHED-1 (G1, H5): the daily close is due DaemonRunDelayMinutes after
// Asia/Bahrain midnight. At 00:05 Bahrain (21:05 UTC the previous day)
// with a 15-minute grace, nothing may run yet. A nil pool makes any
// premature RunDailyBatch call panic, which this test reports.
func TestRunIfDue_UsesBahrainCalendarDate(t *testing.T) {
	timeNow = func() time.Time { return time.Date(2026, 9, 10, 21, 5, 0, 0, time.UTC) }
	defer func() { timeNow = time.Now }()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("runIfDue started a batch run at 00:05 Bahrain, inside the 15-minute grace (it used the UTC date): %v", r)
		}
	}()
	runIfDue(context.Background(), nil, 15)
}
