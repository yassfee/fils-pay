package scheduler

import (
	"bytes"
	"context"
	"log"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// G1 / H5 (case file Page 3/4): "The daily close is running at 3am local,
// not midnight" / "the daily close timing doesn't match what the docs say".
// The business day runs midnight to midnight Asia/Bahrain, so the daemon
// must close day D once Bahrain midnight (+ the default 15-minute grace,
// SETTLEMENT_DAEMON_RUN_DELAY_MINUTES) has passed, not at 03:00 Bahrain.
//
// The daemon's own runIfDue is driven with a READ-ONLY pool: the run it
// starts fails at its first INSERT, so nothing is closed for anyone in the
// shared database, while the daemon's log line still names the business
// date it chose to close.
func TestCaseFile_G1(t *testing.T) {
	t.Run("G1/H5: daily close ran at 3am local, now it closes the Bahrain day just after Bahrain midnight", func(t *testing.T) {
		url := os.Getenv("DATABASE_URL")
		if url == "" {
			t.Skip("DATABASE_URL not set")
		}
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			t.Fatalf("parse DATABASE_URL: %v", err)
		}
		cfg.ConnConfig.RuntimeParams["default_transaction_read_only"] = "on"
		pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
		if err != nil {
			t.Fatalf("connect: %v", err)
		}
		defer pool.Close()

		var buf bytes.Buffer
		log.SetOutput(&buf)
		defer log.SetOutput(os.Stderr)
		defer func() { timeNow = time.Now }()
		bahrain := time.FixedZone("Asia/Bahrain", 3*60*60)
		tick := func(at time.Time) string {
			buf.Reset()
			timeNow = func() time.Time { return at }
			runIfDue(context.Background(), pool, 15)
			return buf.String()
		}

		for _, c := range []struct {
			at   time.Time
			want string // business date the daemon must close, "" = none yet
		}{
			{time.Date(2025, 2, 25, 0, 5, 0, 0, bahrain), ""},            // inside the grace after Bahrain midnight
			{time.Date(2025, 2, 25, 0, 20, 0, 0, bahrain), "2025-02-24"}, // just after midnight + grace (21:20 UTC on the 24th)
			{time.Date(2025, 2, 25, 2, 59, 0, 0, bahrain), "2025-02-24"}, // before 3am local (still the 24th in UTC)
		} {
			out := tick(c.at)
			ran := strings.Contains(out, "RunDailyBatch(")
			if c.want == "" && ran {
				t.Errorf("at %s Bahrain the daemon already ran a close: %q", c.at.Format("15:04"), out)
			}
			if c.want != "" && !strings.Contains(out, "RunDailyBatch("+c.want+")") {
				t.Errorf("at %s Bahrain the daemon did not close business day %s: %q", c.at.Format("2006-01-02 15:04"), c.want, out)
			}
		}
		// the day itself is never closed before Bahrain midnight
		if out := tick(time.Date(2025, 2, 24, 23, 50, 0, 0, bahrain)); strings.Contains(out, "RunDailyBatch(2025-02-24)") {
			t.Errorf("at 23:50 Bahrain the daemon closed the still-open day 2025-02-24: %q", out)
		}
	})
}
