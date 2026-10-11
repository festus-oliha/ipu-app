import "server-only";
import type { EntryType, Prisma } from "@/generated/prisma/client";
import { db } from "./db";

/**
 * Ledger rules (System Design §3): rows are never edited or deleted.
 * A correction is a REVERSAL row pointing at the original; reversed rows and
 * the reversal rows themselves are left out of every total.
 */
export const LIVE: Prisma.LedgerEntryWhereInput = { reversedBy: { is: null }, type: { not: "REVERSAL" } };

/** Types a payment form may record in phase 2. Interest and repayments arrive with loans. */
export const PAYMENT_TYPES = ["CONTRIBUTION", "MEMBERSHIP_FEE"] as const satisfies readonly EntryType[];

export const ENTRY_LABELS: Record<EntryType, string> = {
  CONTRIBUTION: "Contribution",
  MEMBERSHIP_FEE: "Membership fee",
  INTEREST_PAID: "Interest paid",
  LOAN_REPAID: "Loan repaid",
  OTHER_INCOME: "Other income",
  INVESTMENT_RETURNED: "Investment returned",
  LOAN_GIVEN: "Loan given",
  INVESTMENT_PLACED: "Investment placed",
  EXPENSE: "Expense",
  PAYOUT: "Payout",
  INTEREST_CHARGED: "Interest charged",
  DEDUCTION: "Deduction",
  REVERSAL: "Reversal",
  LOAN_DEDUCTED: "Loan taken from savings",
  INTEREST_DEDUCTED: "Interest taken from savings",
  CREDIT_REFUNDED: "Interest credit refunded",
};

/** Money in (+), money out (−) or no cash (0) for the bank balance. */
export const BANK_EFFECT: Record<EntryType, 1 | -1 | 0> = {
  CONTRIBUTION: 1,
  MEMBERSHIP_FEE: 1,
  INTEREST_PAID: 1,
  LOAN_REPAID: 1,
  OTHER_INCOME: 1,
  INVESTMENT_RETURNED: 1,
  LOAN_GIVEN: -1,
  INVESTMENT_PLACED: -1,
  EXPENSE: -1,
  PAYOUT: -1,
  INTEREST_CHARGED: 0,
  DEDUCTION: 0,
  REVERSAL: 0,
  LOAN_DEDUCTED: 0,
  INTEREST_DEDUCTED: 0,
  CREDIT_REFUNDED: 0,
};

/** Every row type that changes a member's loan account. */
export const LOAN_TYPES: EntryType[] = ["LOAN_GIVEN", "LOAN_REPAID", "INTEREST_CHARGED", "INTEREST_PAID", "LOAN_DEDUCTED", "INTEREST_DEDUCTED", "CREDIT_REFUNDED"];

/** A member's totals for one financial year, from live ledger rows. */
export async function memberYearTotals(memberId: string, year: { id: string }) {
  const rows = await db.ledgerEntry.groupBy({
    by: ["type", "periodId"],
    where: { ...LIVE, memberId, period: { yearId: year.id } },
    _sum: { amountKobo: true },
  });
  let contributions = 0n;
  let membershipFees = 0n;
  const monthsWithContribution = new Set<string>();
  for (const r of rows) {
    const amount = r._sum.amountKobo ?? 0n;
    if (r.type === "CONTRIBUTION") {
      contributions += amount;
      if (amount > 0n) monthsWithContribution.add(r.periodId);
    }
    if (r.type === "MEMBERSHIP_FEE") membershipFees += amount;
  }
  return { contributions, membershipFees, monthsContributed: monthsWithContribution.size };
}

/** Names of the officers who entered rows, keyed by user id. */
export async function officerNames(userIds: string[]) {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, phone: true, member: { select: { fullName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.member?.fullName ?? u.phone]));
}
