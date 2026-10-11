-- Phase 6: members whose phone is not known yet, loans with a verbal guarantor
-- (imported from the workbook), and contributions that cover several months.
ALTER TABLE "Member" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "Loan" ALTER COLUMN "guarantorId" DROP NOT NULL;
ALTER TABLE "LedgerEntry" ADD COLUMN "coversMonths" INTEGER;
