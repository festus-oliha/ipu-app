import "server-only";
import { db } from "./db";
import { BANK_EFFECT, LIVE, coveredMonths } from "./ledger";
import { positionsThrough } from "./loans";

export type SheetRow = {
  memberId: string;
  memberNo: string;
  name: string;
  status: string;
  contribution: bigint;
  membershipFee: bigint;
  loanGiven: bigint;
  interestPaid: bigint;
  loanRepaid: bigint;
  /** Workbook column J: loan balance at the end of the month. */
  loanBalance: bigint;
  /** Workbook column K: interest due by the 15th of next month (after close; > 0 owed, < 0 credit). */
  interestOwed: bigint;
  savingsToDate: bigint;
  monthsToDate: number;
  /** This month is already paid for by a contribution made ahead in an earlier month. */
  paidAhead: boolean;
  /** A contribution this month covers this many months (paid ahead). */
  coversMonths: number;
};

const ZERO = { contribution: 0n, membershipFee: 0n, loanGiven: 0n, interestPaid: 0n, loanRepaid: 0n };
const FIELD: Record<string, keyof typeof ZERO> = {
  CONTRIBUTION: "contribution",
  MEMBERSHIP_FEE: "membershipFee",
  LOAN_GIVEN: "loanGiven",
  INTEREST_PAID: "interestPaid",
  LOAN_REPAID: "loanRepaid",
};

/**
 * The month sheet (the workbook's March … February tabs) built from the ledger:
 * one row per active member, plus anyone with money or a loan in that month.
 */
export async function buildMonthSheet(period: { id: string; yearId: string; month: Date }) {
  const thisKey = period.month.toISOString().slice(0, 7);
  const [monthRows, ytdRows, members, bankRows, positions, covered, batches] = await Promise.all([
    db.ledgerEntry.groupBy({
      by: ["memberId", "type"],
      where: { ...LIVE, periodId: period.id, memberId: { not: null } },
      _sum: { amountKobo: true },
    }),
    db.ledgerEntry.groupBy({
      by: ["memberId", "periodId"],
      where: { ...LIVE, type: "CONTRIBUTION", memberId: { not: null }, period: { yearId: period.yearId, month: { lte: period.month } } },
      _sum: { amountKobo: true },
    }),
    db.member.findMany({ orderBy: { memberNo: "asc" } }),
    db.ledgerEntry.groupBy({ by: ["type"], where: { ...LIVE, periodId: period.id }, _sum: { amountKobo: true } }),
    positionsThrough(period.month),
    coveredMonths({ id: period.yearId }),
    db.ledgerEntry.groupBy({ by: ["memberId"], where: { ...LIVE, periodId: period.id, type: "CONTRIBUTION", coversMonths: { gt: 1 } }, _max: { coversMonths: true } }),
  ]);
  const batchBy = new Map(batches.map((b) => [b.memberId!, b._max.coversMonths ?? 1]));

  const month = new Map<string, typeof ZERO>();
  for (const r of monthRows) {
    const field = FIELD[r.type];
    if (!field) continue;
    const m = month.get(r.memberId!) ?? { ...ZERO };
    m[field] += r._sum.amountKobo ?? 0n;
    month.set(r.memberId!, m);
  }
  const ytd = new Map<string, { savings: bigint; months: number }>();
  for (const r of ytdRows) {
    const amount = r._sum.amountKobo ?? 0n;
    const y = ytd.get(r.memberId!) ?? { savings: 0n, months: 0 };
    y.savings += amount;
    if (amount > 0n) y.months += 1;
    ytd.set(r.memberId!, y);
  }

  const rows: SheetRow[] = members
    .filter((m) => m.status === "ACTIVE" || month.has(m.id) || (positions.get(m.id)?.principal ?? 0n) > 0n)
    .map((m) => {
      const pos = positions.get(m.id) ?? { principal: 0n, interestOwed: 0n };
      return {
        memberId: m.id,
        memberNo: m.memberNo,
        name: [m.title, m.fullName].filter(Boolean).join(" "),
        status: m.status,
        ...(month.get(m.id) ?? ZERO),
        loanBalance: pos.principal,
        interestOwed: pos.interestOwed,
        savingsToDate: ytd.get(m.id)?.savings ?? 0n,
        monthsToDate: Math.max(ytd.get(m.id)?.months ?? 0, [...(covered.get(m.id) ?? [])].filter((k) => k <= thisKey).length),
        paidAhead: !(month.get(m.id)?.contribution) && (covered.get(m.id)?.has(thisKey) ?? false),
        coversMonths: batchBy.get(m.id) ?? 1,
      };
    });

  let bankIn = 0n;
  let bankOut = 0n;
  for (const r of bankRows) {
    const effect = BANK_EFFECT[r.type];
    if (effect > 0) bankIn += r._sum.amountKobo ?? 0n;
    if (effect < 0) bankOut += r._sum.amountKobo ?? 0n;
  }

  const totals = rows.reduce(
    (t, r) => ({
      contribution: t.contribution + r.contribution,
      membershipFee: t.membershipFee + r.membershipFee,
      loanGiven: t.loanGiven + r.loanGiven,
      interestPaid: t.interestPaid + r.interestPaid,
      loanRepaid: t.loanRepaid + r.loanRepaid,
      loanBalance: t.loanBalance + r.loanBalance,
      interestOwed: t.interestOwed + r.interestOwed,
      savingsToDate: t.savingsToDate + r.savingsToDate,
      paid: t.paid + (r.contribution > 0n || r.paidAhead ? 1 : 0),
    }),
    { ...ZERO, loanBalance: 0n, interestOwed: 0n, savingsToDate: 0n, paid: 0 },
  );

  return { rows, totals, bankIn, bankOut, activeMembers: members.filter((m) => m.status === "ACTIVE").length };
}
