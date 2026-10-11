-- Phase 4: deductions at year end / exit, exit details, settlement payment, investment note
ALTER TYPE "EntryType" ADD VALUE 'LOAN_DEDUCTED';
ALTER TYPE "EntryType" ADD VALUE 'INTEREST_DEDUCTED';
ALTER TYPE "EntryType" ADD VALUE 'CREDIT_REFUNDED';

ALTER TABLE "Exit" ADD COLUMN "reason" TEXT,
ADD COLUMN "requestedById" TEXT,
ADD COLUMN "rejectReason" TEXT,
ADD COLUMN "bankRef" TEXT;

ALTER TABLE "Settlement" ADD COLUMN "paidOn" DATE,
ADD COLUMN "bankRef" TEXT;

ALTER TABLE "Investment" ADD COLUMN "note" TEXT;
