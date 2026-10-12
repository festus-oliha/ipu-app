import "server-only";
import { db } from "./db";
import { coveredMonths } from "./ledger";
import { monthKey } from "./periods";

/** Months of unpaid interest needed before a loan can be declared in default. */
export const DEFAULT_AFTER_MONTHS = 2;
/** Months with no contribution, while on loan, before a notice is sent (in the next month). */
export const CONTRIBUTION_NOTICE_AFTER = 2;

/**
 * How many of the latest closed months in a row ended with the previous
 * month's interest still unpaid (from the frozen loan schedule).
 */
export async function interestArrearsMonths(memberId: string) {
  const rows = await db.loanMonth.findMany({
    where: { loan: { borrowerId: memberId } },
    select: { interestOwedKobo: true, period: { select: { month: true } } },
  });
  const byMonth = new Map<number, bigint>();
  for (const r of rows) byMonth.set(r.period.month.getTime(), (byMonth.get(r.period.month.getTime()) ?? 0n) + r.interestOwedKobo);
  let n = 0;
  for (const [, owed] of [...byMonth].sort((a, b) => b[0] - a[0])) {
    if (owed > 0n) n++;
    else break;
  }
  return n;
}

/**
 * Members with a loan paid out who have made no contribution for the last
 * `CONTRIBUTION_NOTICE_AFTER` full months (months before `todayIso`'s month,
 * in the current year, from the month the loan was paid out). A payment
 * made ahead counts as contributing.
 */
export async function notContributing(todayIso: string) {
  const thisMonth = new Date(`${todayIso.slice(0, 7)}-01T00:00:00Z`);
  const year = await db.financialYear.findFirst({ where: { status: { not: "CLOSED" }, startDate: { lte: thisMonth }, endDate: { gte: thisMonth } } });
  if (!year) return [];
  const loans = await db.loan.findMany({
    where: { status: { in: ["DISBURSED", "DEFAULTED"] }, borrower: { status: "ACTIVE" } },
    include: { borrower: true },
    orderBy: { disbursedOn: "asc" },
  });
  if (!loans.length) return [];
  const covered = await coveredMonths(year);
  const out = new Map<string, { member: (typeof loans)[number]["borrower"]; months: Date[] }>();
  for (const l of loans) {
    if (out.has(l.borrowerId)) continue;
    const from = l.disbursedOn ? new Date(Date.UTC(l.disbursedOn.getUTCFullYear(), l.disbursedOn.getUTCMonth(), 1)) : year.startDate;
    const missed: Date[] = [];
    for (let i = 1; i <= 12; i++) {
      const m = new Date(Date.UTC(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - i, 1));
      if (m < year.startDate || m < from) break;
      if (covered.get(l.borrowerId)?.has(monthKey(m))) break;
      missed.unshift(m);
    }
    if (missed.length >= CONTRIBUTION_NOTICE_AFTER) out.set(l.borrowerId, { member: l.borrower, months: missed });
  }
  return [...out.values()];
}

/** The year-end notice is given in January and February (the last two months of the year). */
export const yearEndNoticeOpen = (todayIso: string) => ["01", "02"].includes(todayIso.slice(5, 7));
