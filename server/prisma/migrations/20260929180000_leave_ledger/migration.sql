-- Additive only: no existing leave, attendance or payroll rows are touched, and there is no backfill.
-- Carry-forward stays OFF (carry_forward_max_days = 0) until HR sets a cap in HR Settings.

CREATE TYPE "LeaveLedgerKind" AS ENUM ('CARRY_FORWARD', 'ADJUSTMENT');

ALTER TABLE hr_policy
  ADD COLUMN carry_forward_max_days INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN carry_forward_start_month TEXT;

CREATE TABLE leave_ledger_entries (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind          "LeaveLedgerKind" NOT NULL,
  month         TEXT NOT NULL,
  days          DECIMAL(5,2) NOT NULL,
  source_month  TEXT,
  source_cap    DECIMAL(5,2),
  unused_days   DECIMAL(5,2),
  lapsed_days   DECIMAL(5,2),
  cap_applied   INTEGER,
  note          TEXT,
  created_by    TEXT,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TIMESTAMP(3)
);
CREATE INDEX leave_ledger_entries_employee_id_month_idx ON leave_ledger_entries(employee_id, month);
-- At most one LIVE carry-forward row per employee per month (superseded ones are history).
CREATE UNIQUE INDEX leave_ledger_one_live_carry ON leave_ledger_entries(employee_id, month)
  WHERE kind = 'CARRY_FORWARD' AND superseded_at IS NULL;
