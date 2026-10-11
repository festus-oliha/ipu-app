import "server-only";
import type { LoanStatus, Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { LIVE } from "./ledger";
import { positionFromRows, type LoanPosition } from "./position";

type Tx = Prisma.TransactionClient;

/** Loans that still tie up a guarantor (counted against the limit of two). */
export const OPEN_LOAN_STATUSES: LoanStatus[] = ["REQUESTED", "GUARANTOR_ACCEPTED", "PRESIDENT_APPROVED", "APPROVED", "DISBURSED"];
/** Requests not yet paid out. */
export const PENDING_STATUSES: LoanStatus[] = ["REQUESTED", "GUARANTOR_ACCEPTED", "PRESIDENT_APPROVED", "APPROVED"];

export const LOAN_STATUS_LABELS: Record<LoanStatus, string> = {
  REQUESTED: "Waiting for guarantor",
  GUARANTOR_ACCEPTED: "Waiting for President",
  PRESIDENT_APPROVED: "Waiting for Treasurer",
  APPROVED: "Approved, to be paid out",
  DISBURSED: "Paid out",
  CLOSED: "Repaid",
  REJECTED: "Not approved",
  DEFAULTED: "Defaulted",
};

/**
 * A member's loan account from live ledger rows.
 * `throughMonth` (first day of a month) limits it to rows up to that month.
 */
export async function memberPosition(memberId: string, throughMonth?: Date, tx: Tx | typeof db = db): Promise<LoanPosition> {
  const rows = await tx.ledgerEntry.findMany({
    where: {
      ...LIVE,
      memberId,
      type: { in: ["LOAN_GIVEN", "LOAN_REPAID", "INTEREST_CHARGED", "INTEREST_PAID"] },
      ...(throughMonth ? { period: { month: { lte: throughMonth } } } : {}),
    },
    select: { type: true, amountKobo: true },
  });
  return positionFromRows(rows);
}

/** Positions for many members at once (for the monthly sheet and month close). */
export async function positionsThrough(throughMonth: Date, tx: Tx | typeof db = db) {
  const rows = await tx.ledgerEntry.groupBy({
    by: ["memberId", "type"],
    where: {
      ...LIVE,
      memberId: { not: null },
      type: { in: ["LOAN_GIVEN", "LOAN_REPAID", "INTEREST_CHARGED", "INTEREST_PAID"] },
      period: { month: { lte: throughMonth } },
    },
    _sum: { amountKobo: true },
  });
  const byMember = new Map<string, { type: string; amountKobo: bigint }[]>();
  for (const r of rows) {
    const list = byMember.get(r.memberId!) ?? [];
    list.push({ type: r.type, amountKobo: r._sum.amountKobo ?? 0n });
    byMember.set(r.memberId!, list);
  }
  return new Map([...byMember].map(([id, list]) => [id, positionFromRows(list)]));
}

/** Requests approved or in progress but not yet paid out — count toward the limit. */
export async function pendingLoanTotal(memberId: string) {
  const r = await db.loan.aggregate({ where: { borrowerId: memberId, status: { in: PENDING_STATUSES } }, _sum: { amountKobo: true } });
  return r._sum.amountKobo ?? 0n;
}

export async function activeGuarantees(guarantorId: string, exceptLoanId?: string) {
  return db.loan.count({ where: { guarantorId, status: { in: OPEN_LOAN_STATUSES }, ...(exceptLoanId ? { id: { not: exceptLoanId } } : {}) } });
}

/** Paid-out loans are marked repaid once the member owes nothing at all. */
export async function closeLoansIfCleared(memberId: string, tx: Tx) {
  const pos = await memberPosition(memberId, undefined, tx);
  if (pos.principal <= 0n && pos.interestOwed <= 0n) {
    await tx.loan.updateMany({ where: { borrowerId: memberId, status: "DISBURSED" }, data: { status: "CLOSED", closedAt: new Date() } });
  }
}
