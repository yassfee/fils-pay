-- IMP-2 (F7): the same CSV posted twice on 2026-09-04 doubled the corrections.
-- One import per distinct content; pre-existing rows stay NULL (not unique-checked).
ALTER TABLE adjustment_imports ADD COLUMN content_sha256 TEXT;
CREATE UNIQUE INDEX adjustment_imports_content_sha256_key ON adjustment_imports (content_sha256);
