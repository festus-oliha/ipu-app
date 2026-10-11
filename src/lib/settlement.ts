import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "./audit";
import { memberYearTotals } from "./ledger";
import { closeLoansIfCleared, memberPosition } from "./loans";
import { settle } from "./rules";

type Tx = Prisma.TransactionClient;

/** A member's money for settling: this year's contributions and their whole loan account. */
export async function memberFigures(memberId: string, year: { id: string }, tx?: Tx) {
  const [totals, position] = await Promise.all([memberYearTotals(memberId, year), memberPosition(memberId, undefined, tx)]);
  return { ...totals, position };
}

export type Settled = ReturnType<typeof settle>;

/**
 * Posts the no-cash rows of a settlement: credit refunded, interest and loan
 * taken from savings. The bank transfer itself (PAYOUT) is posted separately.
 */
export async function postDeductions(
  input: { memberId: string; date: Date; periodId: string; settled: Settled; officerId: string; note: string },
  tx: Tx,
) {
  const loan = await tx.loan.findFirst({ where: { borrowerId: input.memberId, status: { in: ["DISBURSED", "CLOSED", "DEFAULTED"] } }, orderBy: { disbursedOn: "desc" } });
  const rows = [
    { type: "CREDIT_REFUNDED" as const, kobo: input.settled.credit },
    { type: "INTEREST_DEDUCTED" as const, kobo: input.settled.interestDeducted },
    { type: "LOAN_DEDUCTED" as const, kobo: input.settled.loanDeducted },
  ].filter((r) => r.kobo > 0n);
  for (const r of rows) {
    const entry = await tx.ledgerEntry.create({
      data: { date: input.date, periodId: input.periodId, memberId: input.memberId, loanId: loan?.id, type: r.type, amountKobo: r.kobo, note: input.note, enteredById: input.officerId },
    });
    await audit({ userId: input.officerId, action: "settle.deduct", table: "LedgerEntry", recordId: entry.id, newValue: entry }, tx);
  }
  if (rows.length) await closeLoansIfCleared(input.memberId, tx);
}
