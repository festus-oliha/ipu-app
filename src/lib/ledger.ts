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
  DEDUCTION: "Taken from savings",
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

const monthKeyOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * The months each member's contributions cover in a year. A contribution paid
 * ahead (coversMonths > 1, e.g. ₦60,000 for four months at ₦15,000) counts for
 * its own month and the following ones, up to February.
 */
export async function coveredMonths(year: { id: string }, memberId?: string) {
  const rows = await db.ledgerEntry.findMany({
    where: { ...LIVE, type: "CONTRIBUTION", amountKobo: { gt: 0 }, memberId: memberId ?? { not: null }, period: { yearId: year.id } },
    select: { memberId: true, coversMonths: true, period: { select: { month: true } } },
    orderBy: [{ period: { month: "asc" } }, { createdAt: "asc" }],
  });
  const last = await db.period.findFirst({ where: { yearId: year.id }, orderBy: { month: "desc" }, select: { month: true } });
  const map = new Map<string, Set<string>>();
  // Ordinary payments first: each counts for its own month.
  for (const r of rows) {
    const set = map.get(r.memberId!) ?? new Set<string>();
    if ((r.coversMonths ?? 1) <= 1) set.add(monthKeyOf(r.period.month));
    map.set(r.memberId!, set);
  }
  // Payments made ahead fill the next months not yet paid for, from their own month on
  // (₦60,000 in April = April–July; another ₦60,000 in July = August–November).
  for (const r of rows) {
    if ((r.coversMonths ?? 1) <= 1) continue;
    const set = map.get(r.memberId!)!;
    let filled = 0;
    for (let i = 0; filled < r.coversMonths! && i < 24; i++) {
      const m = new Date(Date.UTC(r.period.month.getUTCFullYear(), r.period.month.getUTCMonth() + i, 1));
      if (last && m > last.month) break;
      const k = monthKeyOf(m);
      if (!set.has(k)) {
        set.add(k);
        filled++;
      }
    }
  }
  return map;
}

/** A member's totals for one financial year, from live ledger rows. */
export async function memberYearTotals(memberId: string, year: { id: string }) {
  const rows = await db.ledgerEntry.groupBy({
    by: ["type", "periodId"],
    where: { ...LIVE, memberId, period: { yearId: year.id } },
    _sum: { amountKobo: true },
  });
  let contributions = 0n;
  let deducted = 0n;
  let membershipFees = 0n;
  const monthsWithContribution = new Set<string>();
  for (const r of rows) {
    const amount = r._sum.amountKobo ?? 0n;
    if (r.type === "CONTRIBUTION") {
      contributions += amount;
      if (amount > 0n) monthsWithContribution.add(r.periodId);
    }
    if (r.type === "MEMBERSHIP_FEE") membershipFees += amount;
    if (r.type === "DEDUCTION") deducted += amount;
  }
  // Savings = what was paid in, less anything already taken to clear a debt
  // (the member's own, or a loan they guaranteed).
  // Months paid for, counting months covered by a payment made ahead.
  const covered = (await coveredMonths(year, memberId)).get(memberId);
  const monthsContributed = Math.max(covered?.size ?? 0, monthsWithContribution.size);
  return { contributions, deducted, savings: contributions - deducted, membershipFees, monthsContributed };
}

/** Names of the officers who entered rows, keyed by user id. */
export async function officerNames(userIds: string[]) {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, phone: true, member: { select: { fullName: true } } },
  });
  return new Map(users.map((u) => [u.id, u.member?.fullName ?? u.phone]));
}
