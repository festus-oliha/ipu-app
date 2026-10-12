import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { BANK_EFFECT, LIVE } from "./ledger";
import { positionsThrough } from "./loans";
import { closeLoanMonth } from "./rules";
import { settingsAt } from "./settings";

type Tx = Prisma.TransactionClient;

export const OPENING_BANK_KEY = "OPENING_BANK_KOBO";

/** The bank balance the union had on 1 March, entered once by the Admin or Treasurer. */
export async function openingBank(year: { startDate: Date }) {
  const s = await db.setting.findUnique({ where: { key_effectiveFrom: { key: OPENING_BANK_KEY, effectiveFrom: year.startDate } } });
  return s ? BigInt(s.value) : null;
}

/** Expected bank balance at the end of a month: opening + money in − money out, from live ledger rows. */
export async function expectedBank(period: { yearId: string; month: Date }, opening: bigint, tx: Tx | typeof db = db) {
  const rows = await tx.ledgerEntry.groupBy({
    by: ["type"],
    where: { ...LIVE, period: { yearId: period.yearId, month: { lte: period.month } } },
    _sum: { amountKobo: true },
  });
  return rows.reduce((total, r) => total + BigInt(BANK_EFFECT[r.type]) * (r._sum.amountKobo ?? 0n), opening);
}

/** Last day of the month that starts on `month`. */
export const monthEnd = (month: Date) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));

/**
 * Charges each borrower's interest for the month (₦25 per ₦1,000 on the
 * closing balance) and freezes the loan schedule. Uses the tested
 * calculation engine (closeLoanMonth). Returns what was charged, per member.
 */
export async function chargeInterest(period: { id: string; month: Date }, enteredById: string, tx: Tx) {
  const previousMonth = new Date(Date.UTC(period.month.getUTCFullYear(), period.month.getUTCMonth() - 1, 1));
  const [before, now] = await Promise.all([positionsThrough(previousMonth, tx), positionsThrough(period.month, tx)]);

  // The interest rate in force for this month (a later change does not alter past months).
  const rules = await settingsAt(period.month);
  const charged: { memberId: string; charge: bigint; nextOwed: bigint; closing: bigint }[] = [];
  for (const [memberId, end] of now) {
    const start = before.get(memberId) ?? { principal: 0n, interestOwed: 0n };
    if (end.principal <= 0n && start.principal <= 0n) continue;

    const activity = await tx.ledgerEntry.groupBy({
      by: ["type"],
      where: { ...LIVE, memberId, periodId: period.id, type: { in: ["LOAN_GIVEN", "LOAN_REPAID", "INTEREST_PAID"] } },
      _sum: { amountKobo: true },
    });
    const sumOf = (t: string) => activity.find((a) => a.type === t)?._sum.amountKobo ?? 0n;
    // Money taken from savings (exit, default) counts like a payment; a refunded credit like a charge.
    const result = closeLoanMonth(start, {
      given: sumOf("LOAN_GIVEN"),
      principalRepaid: sumOf("LOAN_REPAID") + sumOf("LOAN_DEDUCTED"),
      interestPaid: sumOf("INTEREST_PAID") + sumOf("INTEREST_DEDUCTED") - sumOf("CREDIT_REFUNDED"),
    }, rules);

    const loan = await tx.loan.findFirst({ where: { borrowerId: memberId, status: { in: ["DISBURSED", "CLOSED"] } }, orderBy: { disbursedOn: "desc" } });
    if (result.charge > 0n) {
      await tx.ledgerEntry.create({
        data: { date: monthEnd(period.month), periodId: period.id, memberId, type: "INTEREST_CHARGED", amountKobo: result.charge, loanId: loan?.id, note: `Monthly interest, ₦${rules.interestPer1000} per ₦1,000`, enteredById },
      });
    }
    if (loan) {
      await tx.loanMonth.upsert({
        where: { loanId_periodId: { loanId: loan.id, periodId: period.id } },
        update: {},
        create: {
          loanId: loan.id,
          periodId: period.id,
          openingKobo: result.opening,
          interestDueKobo: result.interestDue,
          interestPaidKobo: result.interestPaid,
          interestOwedKobo: result.interestOwedAfterPayment,
          principalRepaidKobo: result.principalRepaid,
          closingKobo: result.closing,
          nextInterestKobo: result.nextInterestOwed,
        },
      });
    }
    charged.push({ memberId, charge: result.charge, nextOwed: result.nextInterestOwed, closing: result.closing });
  }
  return charged;
}

