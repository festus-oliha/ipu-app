import "server-only";
import { db } from "./db";
import { LIVE } from "./ledger";
import { positionFromRows } from "./position";

export type StatementMonth = {
  month: Date;
  contribution: bigint;
  membershipFee: bigint;
  loanGiven: bigint;
  interestCharged: bigint;
  interestPaid: bigint;
  loanRepaid: bigint;
  takenFromSavings: bigint;
  paidOut: bigint;
  savingsToDate: bigint;
  loanBalance: bigint;
  interestOwed: bigint;
};

/** A member's year, month by month — the paper statement. */
export async function memberStatement(memberId: string, year: { id: string; startDate: Date }) {
  const [periods, rows, before] = await Promise.all([
    db.period.findMany({ where: { yearId: year.id }, orderBy: { month: "asc" } }),
    db.ledgerEntry.findMany({ where: { ...LIVE, memberId, period: { yearId: year.id } }, include: { period: true } }),
    // loan account brought forward from earlier years
    db.ledgerEntry.findMany({ where: { ...LIVE, memberId, period: { month: { lt: year.startDate } } }, select: { type: true, amountKobo: true } }),
  ]);
  let running = positionFromRows(before);
  const broughtForward = running;
  let savings = 0n;
  const months: StatementMonth[] = periods.map((p) => {
    const inMonth = rows.filter((r) => r.periodId === p.id);
    const sum = (t: string) => inMonth.filter((r) => r.type === t).reduce((s, r) => s + r.amountKobo, 0n);
    const pos = positionFromRows(inMonth);
    running = { principal: running.principal + pos.principal, interestOwed: running.interestOwed + pos.interestOwed };
    savings += sum("CONTRIBUTION") - sum("DEDUCTION");
    return {
      month: p.month,
      contribution: sum("CONTRIBUTION"),
      membershipFee: sum("MEMBERSHIP_FEE"),
      loanGiven: sum("LOAN_GIVEN"),
      interestCharged: sum("INTEREST_CHARGED"),
      interestPaid: sum("INTEREST_PAID"),
      loanRepaid: sum("LOAN_REPAID"),
      takenFromSavings: sum("DEDUCTION"),
      paidOut: sum("PAYOUT"),
      savingsToDate: savings,
      loanBalance: running.principal,
      interestOwed: running.interestOwed,
    };
  });
  const total = (k: keyof StatementMonth) => months.reduce((t, m) => t + (m[k] as bigint), 0n);
  return {
    months,
    broughtForward,
    totals: {
      contribution: total("contribution"),
      membershipFee: total("membershipFee"),
      loanGiven: total("loanGiven"),
      interestCharged: total("interestCharged"),
      interestPaid: total("interestPaid"),
      loanRepaid: total("loanRepaid"),
      takenFromSavings: total("takenFromSavings"),
      paidOut: total("paidOut"),
    },
    end: running,
  };
}
