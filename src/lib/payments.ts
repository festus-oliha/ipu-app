import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { ENTRY_LABELS, memberYearTotals } from "./ledger";
import { closeLoansIfCleared, memberPosition } from "./loans";
import { formatNairaSms } from "./money";
import { queueSms } from "./notify";
import { formatDate } from "./periods";
import type { LoanPosition } from "./position";

type Tx = Prisma.TransactionClient;

export type PaymentParts = { contribution: bigint; membershipFee: bigint; interestPaid: bigint; loanRepaid: bigint };

export function partsList(p: PaymentParts) {
  return [
    { type: "CONTRIBUTION" as const, kobo: p.contribution },
    { type: "MEMBERSHIP_FEE" as const, kobo: p.membershipFee },
    { type: "INTEREST_PAID" as const, kobo: p.interestPaid },
    { type: "LOAN_REPAID" as const, kobo: p.loanRepaid },
  ].filter((x) => x.kobo > 0n);
}

/** Interest and repayments only make sense against an existing loan account. */
export function loanPartErrors(position: LoanPosition, p: Pick<PaymentParts, "interestPaid" | "loanRepaid">) {
  const errors: Record<string, string> = {};
  if (p.interestPaid > 0n && position.principal <= 0n && position.interestOwed <= 0n) {
    errors.interestPaid = "This member has no loan or interest to pay.";
  }
  if (p.loanRepaid > position.principal) {
    errors.loanRepaid = position.principal > 0n
      ? `More than the loan balance of ${formatNairaSms(position.principal).replace("N", "₦")}.`
      : "This member has no loan to repay.";
  }
  return errors;
}

/** Posts a member's payment as ledger rows (one per part), audited; marks loans repaid when cleared. */
export async function postMemberPayment(
  input: {
    memberId: string;
    date: Date;
    periodId: string;
    parts: PaymentParts;
    bankRef?: string | null;
    note?: string | null;
    receiptId?: string;
    officerId: string;
  },
  tx: Tx,
) {
  for (const p of partsList(input.parts)) {
    const entry = await tx.ledgerEntry.create({
      data: {
        date: input.date,
        periodId: input.periodId,
        memberId: input.memberId,
        type: p.type,
        amountKobo: p.kobo,
        bankRef: input.bankRef || null,
        note: input.note || null,
        receiptId: input.receiptId,
        enteredById: input.officerId,
      },
    });
    await audit({ userId: input.officerId, action: "payment.record", table: "LedgerEntry", recordId: entry.id, newValue: entry }, tx);
  }
  if (input.parts.interestPaid > 0n || input.parts.loanRepaid > 0n) await closeLoansIfCleared(input.memberId, tx);
}

/** The "payment received" SMS with new savings and loan balance. */
export async function paymentSms(member: { id: string; phone: string }, year: { id: string }, date: Date, parts: PaymentParts) {
  const totals = await memberYearTotals(member.id, year);
  const after = await memberPosition(member.id);
  const what = partsList(parts).map((p) => `${formatNairaSms(p.kobo)} ${ENTRY_LABELS[p.type].toLowerCase()}`).join(" + ");
  const loanText =
    after.principal > 0n
      ? ` Loan balance: ${formatNairaSms(after.principal)}.`
      : parts.interestPaid + parts.loanRepaid > 0n && after.interestOwed <= 0n
        ? " Your loan is fully repaid."
        : "";
  await queueSms(member.phone, "payment.recorded", `IPU: ${what} received ${formatDate(date)}. Savings this year: ${formatNairaSms(totals.contributions)}.${loanText} Thank you.`);
}
