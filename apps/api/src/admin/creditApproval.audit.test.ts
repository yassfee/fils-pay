/** Audit regression tests for credit maker-checker (ADMIN-CRED-2, case ref H3). */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertDistinctApprover } from "./creditApproval.js";

// ADMIN-CRED-2 (H3): two-person control is about the admin user, not the display name.
test("ADMIN-CRED-2: the same admin under a different display name cannot approve their own credit", () => {
  const id = randomUUID();
  assert.throws(
    () => assertDistinctApprover({ adminUserId: id, displayName: "Huda (Finance)" }, { adminUserId: id, displayName: "Huda (Admin)" }),
    { code: "self_approval_forbidden" },
  );
});

test("ADMIN-CRED-2: two different admins who share a display name may approve each other", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover({ adminUserId: randomUUID(), displayName: "Ahmed A." }, { adminUserId: randomUUID(), displayName: "Ahmed A." }),
  );
});
