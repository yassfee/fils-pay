-- GO-1 (F1, ADR-0001/0002): 0050's NUMERIC(10,2) tops out at 99,999,999.99 BD, while a
-- scheme line is any truncated BIGINT fils figure; one larger capture overflowed and failed the close.
-- Raising precision at the same scale keeps every stored value and does not rewrite the table.
ALTER TABLE scheme_export_lines ALTER COLUMN amount TYPE NUMERIC(18, 2);
