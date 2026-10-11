import "server-only";
import { db } from "./db";
import { BANK_EFFECT, LIVE } from "./ledger";

export type SheetRow = {
  memberId: string;
  memberNo: string;
  name: string;
  status: string;
  contribution: bigint;
  membershipFee: bigint;
  savingsToDate: bigint;
  monthsToDate: number;
};

/**
 * The month sheet (the workbook's March … February tabs) built from the ledger:
 * one row per active member, plus anyone who has money in that month.
 */
export async function buildMonthSheet(period: { id: string; yearId: string; month: Date }) {
  const [monthRows, ytdRows, members, bankRows] = await Promise.all([
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
  ]);

  const month = new Map<string, { contribution: bigint; membershipFee: bigint }>();
  for (const r of monthRows) {
    const m = month.get(r.memberId!) ?? { contribution: 0n, membershipFee: 0n };
    if (r.type === "CONTRIBUTION") m.contribution += r._sum.amountKobo ?? 0n;
    if (r.type === "MEMBERSHIP_FEE") m.membershipFee += r._sum.amountKobo ?? 0n;
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
    .filter((m) => m.status === "ACTIVE" || month.has(m.id))
    .map((m) => ({
      memberId: m.id,
      memberNo: m.memberNo,
      name: [m.title, m.fullName].filter(Boolean).join(" "),
      status: m.status,
      contribution: month.get(m.id)?.contribution ?? 0n,
      membershipFee: month.get(m.id)?.membershipFee ?? 0n,
      savingsToDate: ytd.get(m.id)?.savings ?? 0n,
      monthsToDate: ytd.get(m.id)?.months ?? 0,
    }));

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
      savingsToDate: t.savingsToDate + r.savingsToDate,
      paid: t.paid + (r.contribution > 0n ? 1 : 0),
    }),
    { contribution: 0n, membershipFee: 0n, savingsToDate: 0n, paid: 0 },
  );

  return { rows, totals, bankIn, bankOut, activeMembers: members.filter((m) => m.status === "ACTIVE").length };
}
