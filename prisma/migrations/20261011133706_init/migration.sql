-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'PRESIDENT', 'TREASURER', 'SECRETARY', 'AUDITOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXITED');

-- CreateEnum
CREATE TYPE "YearStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'READY', 'SIGNED', 'LOCKED');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('CONTRIBUTION', 'MEMBERSHIP_FEE', 'INTEREST_PAID', 'LOAN_REPAID', 'OTHER_INCOME', 'INVESTMENT_RETURNED', 'LOAN_GIVEN', 'INVESTMENT_PLACED', 'EXPENSE', 'PAYOUT', 'INTEREST_CHARGED', 'DEDUCTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('REQUESTED', 'GUARANTOR_ACCEPTED', 'PRESIDENT_APPROVED', 'APPROVED', 'DISBURSED', 'CLOSED', 'REJECTED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "ApprovalStep" AS ENUM ('GUARANTOR', 'PRESIDENT', 'TREASURER', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'MATURED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExitStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementResult" AS ENUM ('PAID', 'DEBTOR');

-- CreateEnum
CREATE TYPE "DebtorPlan" AS ENUM ('PAY_UP', 'CARRY_OVER');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('SMS', 'EMAIL', 'CALL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "memberNo" TEXT NOT NULL,
    "title" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "yearJoined" INTEGER,
    "occupation" TEXT,
    "address" TEXT,
    "emergencyName" TEXT,
    "emergencyPhone" TEXT,
    "usualMonthlyKobo" BIGINT NOT NULL DEFAULT 0,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "YearStatus" NOT NULL DEFAULT 'OPEN',
    "dividendRateBps" INTEGER,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "FinancialYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Period" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "bankStatementKobo" BIGINT,
    "readyById" TEXT,
    "presidentSignedById" TEXT,
    "presidentSignedAt" TIMESTAMP(3),
    "secretarySignedById" TEXT,
    "secretarySignedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),

    CONSTRAINT "Period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "periodId" TEXT NOT NULL,
    "memberId" TEXT,
    "type" "EntryType" NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "loanId" TEXT,
    "investmentId" TEXT,
    "receiptId" TEXT,
    "bankRef" TEXT,
    "note" TEXT,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesId" TEXT,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "fileKey" TEXT,
    "contributionKobo" BIGINT NOT NULL DEFAULT 0,
    "interestKobo" BIGINT NOT NULL DEFAULT 0,
    "repaymentKobo" BIGINT NOT NULL DEFAULT 0,
    "otherKobo" BIGINT NOT NULL DEFAULT 0,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "uploadedById" TEXT NOT NULL,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "guarantorId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'REQUESTED',
    "isException" BOOLEAN NOT NULL DEFAULT false,
    "exceptionReason" TEXT,
    "guarantorToldAt" TIMESTAMP(3),
    "disbursedOn" DATE,
    "bankRef" TEXT,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanApproval" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "step" "ApprovalStep" NOT NULL,
    "decision" "Decision" NOT NULL,
    "reason" TEXT,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanMonth" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "openingKobo" BIGINT NOT NULL,
    "interestDueKobo" BIGINT NOT NULL,
    "interestPaidKobo" BIGINT NOT NULL,
    "interestOwedKobo" BIGINT NOT NULL,
    "principalRepaidKobo" BIGINT NOT NULL,
    "closingKobo" BIGINT NOT NULL,
    "nextInterestKobo" BIGINT NOT NULL,

    CONSTRAINT "LoanMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "amountPlacedKobo" BIGINT NOT NULL,
    "placedOn" DATE NOT NULL,
    "rateBps" INTEGER,
    "maturityOn" DATE,
    "amountReturnedKobo" BIGINT,
    "returnedOn" DATE,
    "proofKey" TEXT,
    "status" "InvestmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "presidentApprovedById" TEXT,
    "treasurerApprovedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exit" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "requestedOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "ExitStatus" NOT NULL DEFAULT 'REQUESTED',
    "contributionsKobo" BIGINT,
    "deductionsKobo" BIGINT,
    "payoutKobo" BIGINT,
    "approvedById" TEXT,
    "paidOn" DATE,

    CONSTRAINT "Exit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "contributionsKobo" BIGINT NOT NULL,
    "monthsContributed" INTEGER NOT NULL,
    "dividendKobo" BIGINT NOT NULL,
    "creditRefundKobo" BIGINT NOT NULL,
    "loanDeductedKobo" BIGINT NOT NULL,
    "interestDeductedKobo" BIGINT NOT NULL,
    "guarantorRecoveryKobo" BIGINT NOT NULL DEFAULT 0,
    "payoutKobo" BIGINT NOT NULL,
    "result" "SettlementResult" NOT NULL,
    "debtorPlan" "DebtorPlan",
    "debtorDueOn" DATE,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactLog" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "outcome" TEXT NOT NULL,
    "promisedOn" DATE,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalReferral" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "referredOn" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "byId" TEXT NOT NULL,

    CONSTRAINT "LegalReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "template" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "costKobo" BIGINT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Member_memberNo_key" ON "Member"("memberNo");

-- CreateIndex
CREATE UNIQUE INDEX "Member_phone_key" ON "Member"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Member_userId_key" ON "Member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialYear_label_key" ON "FinancialYear"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Period_yearId_month_key" ON "Period"("yearId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_effectiveFrom_key" ON "Setting"("key", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_reversesId_key" ON "LedgerEntry"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerEntry_memberId_date_idx" ON "LedgerEntry"("memberId", "date");

-- CreateIndex
CREATE INDEX "LedgerEntry_periodId_type_idx" ON "LedgerEntry"("periodId", "type");

-- CreateIndex
CREATE INDEX "LedgerEntry_loanId_idx" ON "LedgerEntry"("loanId");

-- CreateIndex
CREATE INDEX "Loan_borrowerId_status_idx" ON "Loan"("borrowerId", "status");

-- CreateIndex
CREATE INDEX "Loan_guarantorId_status_idx" ON "Loan"("guarantorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LoanMonth_loanId_periodId_key" ON "LoanMonth"("loanId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_yearId_memberId_key" ON "Settlement"("yearId", "memberId");

-- CreateIndex
CREATE INDEX "AuditLog_table_recordId_idx" ON "AuditLog"("table", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_at_idx" ON "AuditLog"("userId", "at");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Period" ADD CONSTRAINT "Period_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_guarantorId_fkey" FOREIGN KEY ("guarantorId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApproval" ADD CONSTRAINT "LoanApproval_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanMonth" ADD CONSTRAINT "LoanMonth_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanMonth" ADD CONSTRAINT "LoanMonth_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "Period"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exit" ADD CONSTRAINT "Exit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "FinancialYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalReferral" ADD CONSTRAINT "LegalReferral_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
