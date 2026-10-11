"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNairaSms } from "@/lib/money";
import { OPENING_BANK_KEY, expectedBank, openingBank } from "@/lib/monthClose";
import { queueSms } from "@/lib/notify";
import { monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";
import { postDeductions } from "@/lib/settlement";
import { yearEndPreview, yearToSettle } from "@/lib/yearEnd";

export type YearState = { errors?: Record<string, string>; error?: string; done?: string };

const refresh = () => revalidatePath("/", "layout");

/** Creates the next March–February year and its 12 months, if not there yet. */
async function ensureNextYear(after: { endDate: Date }) {
  const startYear = after.endDate.getUTCFullYear(); // year ends in Feb of startYear
  const label = `${startYear}–${startYear + 1}`;
  const year = await db.financialYear.upsert({
    where: { label },
    update: {},
    create: { label, startDate: new Date(Date.UTC(startYear, 2, 1)), endDate: new Date(Date.UTC(startYear + 1, 2, 0)) },
  });
  for (let i = 0; i < 12; i++) {
    const month = new Date(Date.UTC(startYear, 2 + i, 1));
    await db.period.upsert({ where: { yearId_month: { yearId: year.id, month } }, update: {}, create: { yearId: year.id, month } });
  }
  return year;
}

export async function setDividendRate(yearId: string, _prev: YearState, form: FormData): Promise<YearState> {
  const user = await actionUser("ADMIN");
  const year = await db.financialYear.findUnique({ where: { id: yearId } });
  if (!year || year.status === "CLOSED") return { error: "This year is already closed." };
  const text = String(form.get("rate") ?? "").replace("%", "").trim();
  const rate = Number(text);
  if (!text || !Number.isFinite(rate) || rate < 0 || rate > 100) return { errors: { rate: "Enter the dividend as a percentage, e.g. 4.2." } };
  const bps = Math.round(rate * 100);
  await db.financialYear.update({ where: { id: yearId }, data: { dividendRateBps: bps } });
  await audit({ userId: user.id, action: "year.dividend_rate", table: "FinancialYear", recordId: yearId, oldValue: year.dividendRateBps, newValue: bps });
  refresh();
  return { done: `Dividend set at ${(bps / 100).toFixed(2)}%.` };
}

/** From February, the Admin opens next year's months so March payments can be recorded before the old year is closed. */
export async function openNextYear(): Promise<YearState> {
  const user = await actionUser("ADMIN");
  const newest = await db.financialYear.findFirst({ orderBy: { startDate: "desc" } });
  if (!newest) return { error: "No financial year found." };
  const lastMonthStart = `${newest.endDate.toISOString().slice(0, 7)}-01`;
  if (todayLagos() < lastMonthStart) return { error: `Next year can be opened from 1 ${monthLabel(newest.endDate)}.` };
  const year = await ensureNextYear(newest);
  await audit({ userId: user.id, action: "year.open", table: "FinancialYear", recordId: year.id });
  refresh();
  return { done: `${year.label} is open. March payments can now be recorded.` };
}

/** Admin closes the year: settlements saved, deductions posted, members told. */
export async function closeYear(yearId: string, _prev: YearState, form: FormData): Promise<YearState> {
  const user = await actionUser("ADMIN");
  const year = await yearToSettle();
  if (!year || year.id !== yearId) return { error: "This is not the year waiting to be closed." };
  if (year.dividendRateBps === null) return { error: "Set the dividend rate first." };
  const open = year.periods.filter((p) => p.status === "OPEN");
  if (open.length) return { error: `Close every month first. Still open: ${open.map((p) => monthLabel(p.month)).join(", ")}.` };
  const pendingReceipts = await db.receipt.count({ where: { status: "PENDING", paidOn: { gte: year.startDate, lte: year.endDate } } });
  if (pendingReceipts) return { error: `${pendingReceipts} receipt(s) from this year are still waiting to be checked.` };
  const unpaidExits = await db.exit.count({ where: { status: "APPROVED" } });
  if (unpaidExits) return { error: "An approved exit has not been paid yet. Pay it (or reopen it) first." };
  if (form.get("confirm") !== "CLOSE") return { errors: { confirm: "Type CLOSE in capitals to confirm." } };

  const last = year.periods[year.periods.length - 1];
  const preview = await yearEndPreview(year);
  const next = await ensureNextYear(year);

  await db.$transaction(
    async (tx) => {
      for (const r of preview.rows) {
        await tx.settlement.create({
          data: {
            yearId: year.id,
            memberId: r.memberId,
            contributionsKobo: r.contributions,
            monthsContributed: r.months,
            dividendKobo: r.dividend,
            creditRefundKobo: r.credit,
            loanDeductedKobo: r.loanDeducted,
            interestDeductedKobo: r.interestDeducted,
            payoutKobo: r.payout - r.shortfall, // negative = still owes (debtor)
            result: r.shortfall > 0n ? "DEBTOR" : "PAID",
            debtorPlan: r.shortfall > 0n ? "CARRY_OVER" : null,
          },
        });
        await postDeductions(
          { memberId: r.memberId, date: year.endDate, periodId: last.id, settled: r, officerId: user.id, note: `Year end ${year.label}: taken from savings` },
          tx,
        );
      }
      await tx.financialYear.update({ where: { id: year.id }, data: { status: "CLOSED", closedById: user.id, closedAt: new Date() } });
      await audit({ userId: user.id, action: "year.close", table: "FinancialYear", recordId: year.id, newValue: { ...preview.totals, members: preview.rows.length, rateBps: year.dividendRateBps } }, tx);
    },
    { timeout: 120_000 },
  );

  // Next year's opening bank balance = this year's closing balance (if not entered by hand).
  const opening = await openingBank(year);
  if (opening !== null && (await openingBank(next)) === null) {
    const closing = await expectedBank(last, opening);
    await db.setting.create({ data: { key: OPENING_BANK_KEY, value: closing.toString(), effectiveFrom: next.startDate, createdById: user.id } });
  }

  for (const r of preview.rows) {
    const msg = r.shortfall > 0n
      ? `IPU: Year ${year.label} closed. Your savings and dividend cleared part of your loan; you still owe ${formatNairaSms(r.shortfall)}. The Treasurer will contact you.`
      : `IPU: Year ${year.label} closed. Contributions ${formatNairaSms(r.contributions)} + dividend ${formatNairaSms(r.dividend)}${r.interestDeducted + r.loanDeducted ? ` - loan ${formatNairaSms(r.interestDeducted + r.loanDeducted)}` : ""}. Payout ${formatNairaSms(r.payout)} to your bank.`;
    await queueSms(r.phone, "year.closed", msg);
  }
  refresh();
  return { done: `${year.label} closed. ${preview.rows.length} members settled.` };
}

export async function setDebtorPlan(settlementId: string, _prev: YearState, form: FormData): Promise<YearState> {
  const user = await actionUser("ADMIN");
  const s = await db.settlement.findUnique({ where: { id: settlementId } });
  if (!s || s.result !== "DEBTOR") return { error: "Not a debtor." };
  const plan = form.get("plan") === "PAY_UP" ? "PAY_UP" : "CARRY_OVER";
  const due = plan === "PAY_UP" ? parseDateInput(String(form.get("due") ?? "")) : null;
  if (plan === "PAY_UP" && !due) return { errors: { due: "Enter the date by which it must be paid." } };
  await db.settlement.update({ where: { id: s.id }, data: { debtorPlan: plan, debtorDueOn: due } });
  await audit({ userId: user.id, action: "year.debtor_plan", table: "Settlement", recordId: s.id, oldValue: s.debtorPlan, newValue: { plan, due } });
  refresh();
  return { done: plan === "PAY_UP" ? "Saved: to pay up by the due date." : "Saved: debt carried into the new year." };
}

/** Treasurer records each year-end transfer; it is money out of the new year's bank balance. */
export async function recordSettlementPayout(settlementId: string, _prev: YearState, form: FormData): Promise<YearState> {
  const user = await actionUser("TREASURER");
  const s = await db.settlement.findUnique({ where: { id: settlementId }, include: { member: true, year: true } });
  if (!s || s.payoutKobo <= 0n) return { error: "There is nothing to pay this member." };
  if (s.paidOn) return { error: "Already paid." };
  if (s.member.userId === user.id) return { error: "Another officer must record your own payout." };
  const dateText = String(form.get("date") ?? "");
  const date = parseDateInput(dateText);
  if (!date || dateText > todayLagos()) return { errors: { date: "Enter the transfer date (not in the future)." } };
  if (date <= s.year.endDate) return { errors: { date: "Year-end payouts are made after the year ends." } };
  const period = await periodFor(date);
  if (!period || period.status !== "OPEN") return { errors: { date: period ? `${monthLabel(period.month)} is closed.` : "Open the next financial year first." } };
  const bankRef = String(form.get("bankRef") ?? "").trim() || null;

  await db.$transaction(async (tx) => {
    const claimed = await tx.settlement.updateMany({ where: { id: s.id, paidOn: null }, data: { paidOn: date, bankRef } });
    if (claimed.count !== 1) throw new Error("Already paid.");
    const entry = await tx.ledgerEntry.create({
      data: { date, periodId: period.id, memberId: s.memberId, type: "PAYOUT", amountKobo: s.payoutKobo, bankRef, note: `Year-end payout ${s.year.label}`, enteredById: user.id },
    });
    await audit({ userId: user.id, action: "year.payout", table: "Settlement", recordId: s.id, newValue: entry }, tx);
  });
  refresh();
  return { done: "Payout recorded." };
}
