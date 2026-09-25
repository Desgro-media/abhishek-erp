-- Link a commission / sales-bonus payable back to the approved payment that generated it.
ALTER TABLE "payables" ADD COLUMN "source_payment_id" TEXT;

CREATE INDEX "payables_source_payment_id_idx" ON "payables"("source_payment_id");

ALTER TABLE "payables" ADD CONSTRAINT "payables_source_payment_id_fkey"
  FOREIGN KEY ("source_payment_id") REFERENCES "invoice_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill commissions created before this column existed. Approval wrote the payee as
-- "<sales person> — commission on <invoice no | quote code>", the amount as round(10% of the payment)
-- and due_at as the payment date, so a payable is linked only when exactly ONE payment fits all of
-- that. Anything ambiguous (e.g. two identical payments the same day) is left NULL rather than guessed.
WITH pay AS (
  SELECT p.id AS payment_id, p.amount, p.paid_date, i.invoice_no, q.quote_code,
         COALESCE(ip.sales_person, q.created_by) AS sales_person
  FROM invoice_payments p
  JOIN invoices i ON i.id = p.invoice_id
  LEFT JOIN invoice_pending_payments ip ON ip.invoice_payment_id = p.id
  LEFT JOIN quote_pending_payments qp ON qp.invoice_payment_id = p.id
  LEFT JOIN quotes q ON q.id = qp.quote_id
),
candidates AS (
  SELECT c.id AS payable_id, pay.payment_id
  FROM payables c
  JOIN pay ON pay.sales_person = c.sales_person
          AND c.amount = ROUND(pay.amount * 0.1)
          AND c.due_at = pay.paid_date
          AND (c.payee LIKE '% commission on ' || pay.invoice_no
               OR (pay.quote_code IS NOT NULL AND c.payee LIKE '% commission on ' || pay.quote_code))
  WHERE c.category = 'COMMISSION' AND c.source_payment_id IS NULL
),
unambiguous AS (
  SELECT payable_id, MIN(payment_id) AS payment_id
  FROM candidates GROUP BY payable_id HAVING COUNT(*) = 1
)
UPDATE payables SET source_payment_id = unambiguous.payment_id
FROM unambiguous WHERE payables.id = unambiguous.payable_id;
