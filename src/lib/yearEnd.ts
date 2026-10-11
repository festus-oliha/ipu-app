import "server-only";
import { db } from "./db";
import { LIVE, coveredMonths } from "./ledger";
import { positionsThrough } from "./loans";
import { dividend, qualifiesForDividend, settle } from "./rules";

/** The year to settle: the oldest one not yet closed. */
export async function yearToSettle() {
  return db.financialYear.findFirst({ where: { status: { not: "CLOSED" } }, orderBy: { startDate: "asc" }, include: { periods: { orderBy: { month: "asc" } } } });
}

export type SettlementRow = {
  memberId: string;
  memberNo: string;
  name: string;
  phone: string | null;
  contributions: bigint;
  months: number;
  qualifies: boolean;
  dividend: bigint;
  credit: bigint;
  interestDeducted: bigint;
  loanDeducted: bigint;
  payout: bigint;
  shortfall: bigint;
};

/**
 * Year-end figures for every member still in the union (exited members have
 * already been paid and forfeit the dividend). Same rules as exit, plus the
 * dividend: Payout = contributions + dividend + credit − interest owed − loan.
 */
export async function yearEndPreview(year: { id: string; startDate: Date; endDate: Date; dividendRateBps: number | null }) {
  const lastMonth = new Date(Date.UTC(year.endDate.getUTCFullYear(), year.endDate.getUTCMonth(), 1));
  const rate = year.dividendRateBps ?? 0;
  const [members, contribRows, deductRows, positions, flows, investments] = await Promise.all([
    db.member.findMany({ where: { status: { not: "EXITED" } }, orderBy: { memberNo: "asc" } }),
    db.ledgerEntry.groupBy({ by: ["memberId", "periodId"], where: { ...LIVE, type: "CONTRIBUTION", memberId: { not: null }, period: { yearId: year.id } }, _sum: { amountKobo: true } }),
    db.ledgerEntry.groupBy({ by: ["memberId"], where: { ...LIVE, type: "DEDUCTION", memberId: { not: null }, period: { yearId: year.id } }, _sum: { amountKobo: true } }),
    positionsThrough(lastMonth),
    db.ledgerEntry.groupBy({ by: ["type"], where: { ...LIVE, period: { yearId: year.id } }, _sum: { amountKobo: true } }),
    db.investment.findMany({ where: { status: "MATURED", returnedOn: { gte: year.startDate, lte: year.endDate } } }),
  ]);

  const contrib = new Map<string, { total: bigint; months: number }>();
  for (const r of contribRows) {
    const c = contrib.get(r.memberId!) ?? { total: 0n, months: 0 };
    const amount = r._sum.amountKobo ?? 0n;
    c.total += amount;
    if (amount > 0n) c.months += 1;
    contrib.set(r.memberId!, c);
  }

  const deducted = new Map(deductRows.map((r) => [r.memberId!, r._sum.amountKobo ?? 0n]));
  // Months paid for (a payment made ahead counts for every month it covers).
  const covered = await coveredMonths(year);

  const rows: SettlementRow[] = [];
  for (const m of members) {
    const paid = contrib.get(m.id) ?? { total: 0n, months: 0 };
    // Savings already used during the year (a default, or a loan they guaranteed) are not paid twice.
    const c = { total: paid.total - (deducted.get(m.id) ?? 0n), months: Math.max(covered.get(m.id)?.size ?? 0, paid.months) };
    const pos = positions.get(m.id) ?? { principal: 0n, interestOwed: 0n };
    if (c.total === 0n && pos.principal === 0n && pos.interestOwed === 0n) continue;
    const div = dividend(c.total, rate, c.months);
    const s = settle({ contributions: c.total, dividend: div, principal: pos.principal, interestOwed: pos.interestOwed });
    rows.push({
      memberId: m.id,
      memberNo: m.memberNo,
      name: [m.title, m.fullName].filter(Boolean).join(" "),
      phone: m.phone,
      contributions: c.total,
      months: c.months,
      qualifies: qualifiesForDividend(c.months),
      dividend: div,
      ...s,
    });
  }

  const sumType = (t: string) => flows.find((f) => f.type === t)?._sum.amountKobo ?? 0n;
  const income = {
    interest: sumType("INTEREST_PAID"),
    investmentProfit: investments.reduce((t, i) => t + (i.amountReturnedKobo ?? 0n) - i.amountPlacedKobo, 0n),
    otherIncome: sumType("OTHER_INCOME"),
    membershipFees: sumType("MEMBERSHIP_FEE"),
    expenses: sumType("EXPENSE"),
  };
  const totals = rows.reduce(
    (t, r) => ({
      contributions: t.contributions + r.contributions,
      dividend: t.dividend + r.dividend,
      deducted: t.deducted + r.interestDeducted + r.loanDeducted,
      credit: t.credit + r.credit,
      payout: t.payout + r.payout,
      shortfall: t.shortfall + r.shortfall,
      debtors: t.debtors + (r.shortfall > 0n ? 1 : 0),
    }),
    { contributions: 0n, dividend: 0n, deducted: 0n, credit: 0n, payout: 0n, shortfall: 0n, debtors: 0 },
  );
  // Money the union earned that the dividend is paid from.
  const earned = income.interest + income.investmentProfit + income.otherIncome - income.expenses;
  return { rows, totals, income, earned, lastMonth };
}

/**
 * Year-change reminders for the Admin, worked out from today's date (Lagos):
 * from 1 February open next year's months; from 1 March close the old year.
 */
export async function yearChangeReminders(todayIso: string) {
  const years = await db.financialYear.findMany({ orderBy: { startDate: "asc" }, include: { periods: { orderBy: { month: "asc" } } } });
  const out: { text: string; href: string }[] = [];
  const newest = years[years.length - 1];
  if (newest) {
    const lastMonthStart = newest.endDate.toISOString().slice(0, 8) + "01"; // 1 February
    const nextStart = new Date(Date.UTC(newest.endDate.getUTCFullYear(), 2, 1)).toISOString().slice(0, 10); // 1 March
    const nextLabel = `${newest.endDate.getUTCFullYear()}–${newest.endDate.getUTCFullYear() + 1}`;
    if (todayIso >= lastMonthStart) {
      out.push({
        text: todayIso < nextStart
          ? `Open ${nextLabel} before 1 March, so March payments can be recorded.`
          : `${nextLabel} is not open yet: March payments cannot be recorded until you open it.`,
        href: "/office/year-end",
      });
    }
  }
  for (const y of years) {
    if (y.status === "CLOSED") continue;
    const endedOn = new Date(Date.UTC(y.endDate.getUTCFullYear(), y.endDate.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    if (todayIso < endedOn) continue;
    const open = y.periods.filter((p) => p.status === "OPEN").length;
    out.push({
      text: open
        ? `${y.label} has ended: the Treasurer must close its remaining ${open === 1 ? "month" : `${open} months`}, then you set the dividend and close the year.`
        : `${y.label} has ended: set the dividend rate and close the year.`,
      href: "/office/year-end",
    });
  }
  return out;
}
