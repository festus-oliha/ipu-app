"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira, formatNairaSms, parseNaira } from "@/lib/money";
import { OPENING_BANK_KEY, chargeInterest, expectedBank, openingBank } from "@/lib/monthClose";
import { queueSms } from "@/lib/notify";
import { MONTH_NAMES, monthLabel, todayLagos } from "@/lib/periods";

export type CloseState = { error?: string; difference?: string; statement?: string };

const refresh = () => revalidatePath("/", "layout");

/** Admin or Treasurer records the bank balance on 1 March (once, before March closes). */
export async function setOpeningBank(yearId: string, _prev: CloseState, form: FormData): Promise<CloseState> {
  const user = await actionUser("ADMIN", "TREASURER");
  const year = await db.financialYear.findUnique({ where: { id: yearId }, include: { periods: { orderBy: { month: "asc" }, take: 1 } } });
  if (!year) return { error: "Year not found." };
  if (year.periods[0]?.status !== "OPEN") return { error: "March is already closed. Ask the Admin to reopen it to change the opening balance." };
  let kobo: bigint;
  try {
    kobo = parseNaira(String(form.get("opening") ?? ""));
  } catch {
    return { error: "Enter the bank balance in naira, e.g. 8,115,250." };
  }
  const before = await openingBank(year);
  await db.setting.upsert({
    where: { key_effectiveFrom: { key: OPENING_BANK_KEY, effectiveFrom: year.startDate } },
    update: { value: kobo.toString(), createdById: user.id },
    create: { key: OPENING_BANK_KEY, value: kobo.toString(), effectiveFrom: year.startDate, createdById: user.id },
  });
  await audit({ userId: user.id, action: "bank.opening", table: "Setting", recordId: OPENING_BANK_KEY, oldValue: before, newValue: kobo });
  refresh();
  return {};
}

/** Treasurer closes the month: bank check, interest charged, loan schedules frozen. */
export async function closeMonth(periodId: string, _prev: CloseState, form: FormData): Promise<CloseState> {
  const user = await actionUser("TREASURER");
  const period = await db.period.findUnique({ where: { id: periodId }, include: { year: true } });
  if (!period || period.status !== "OPEN") return { error: "This month is not open." };

  const earlierOpen = await db.period.findFirst({ where: { yearId: period.yearId, month: { lt: period.month }, status: "OPEN" }, orderBy: { month: "asc" } });
  if (earlierOpen) return { error: `Close ${monthLabel(earlierOpen.month)} first. Months are closed in order.` };

  const opening = await openingBank(period.year);
  if (opening === null) return { error: "Enter the opening bank balance for 1 March first." };

  const nextMonth = new Date(Date.UTC(period.month.getUTCFullYear(), period.month.getUTCMonth() + 1, 1));
  if (todayLagos() < nextMonth.toISOString().slice(0, 10)) {
    return { error: `${monthLabel(period.month)} has not ended yet. It can be closed from 1 ${monthLabel(nextMonth)}, once the bank statement is in.` };
  }
  const waiting = await db.receipt.count({ where: { status: "PENDING", paidOn: { gte: period.month, lt: nextMonth } } });
  if (waiting) return { error: `${waiting} uploaded receipt${waiting > 1 ? "s are" : " is"} still waiting to be checked for this month. Confirm or reject ${waiting > 1 ? "them" : "it"} first.` };

  const typed = String(form.get("statement") ?? "");
  let statement: bigint;
  try {
    statement = parseNaira(typed);
  } catch {
    return { error: "Enter the balance on the bank statement at the end of the month.", statement: typed };
  }
  const expected = await expectedBank(period, opening);
  const difference = statement - expected;
  const explanation = String(form.get("explanation") ?? "").trim();
  if (difference !== 0n && explanation.length < 10) {
    return {
      error: `The statement (${formatNaira(statement)}) differs from the app (${formatNaira(expected)}) by ${formatNaira(difference)}. Find the missing entry, or explain the difference below.`,
      difference: difference.toString(),
      statement: typed,
    };
  }

  const charged = await db.$transaction(async (tx) => {
    const result = await chargeInterest(period, user.id, tx);
    await tx.period.update({ where: { id: periodId }, data: { status: "READY", bankStatementKobo: statement, readyById: user.id } });
    await audit(
      { userId: user.id, action: "month.close", table: "Period", recordId: periodId, newValue: { statement, expected, difference, charged: result.length }, reason: explanation || undefined },
      tx,
    );
    return result;
  }, { timeout: 60_000 });

  // Tell each borrower what is due by the 15th of next month.
  const due = MONTH_NAMES[(period.month.getUTCMonth() + 1) % 12];
  const members = await db.member.findMany({ where: { id: { in: charged.map((c) => c.memberId) } } });
  for (const c of charged) {
    const m = members.find((x) => x.id === c.memberId);
    if (!m || c.nextOwed <= 0n) continue;
    await queueSms(m.phone, "interest.due", `IPU: Interest of ${formatNairaSms(c.nextOwed)} is due by 15 ${due}. Loan balance: ${formatNairaSms(c.closing)}.`);
  }

  refresh();
  return {};
}

/** President and Secretary sign a closed month; with both signatures it is locked. */
export async function signMonth(periodId: string): Promise<CloseState> {
  const user = await actionUser("PRESIDENT", "SECRETARY");
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period || (period.status !== "READY" && period.status !== "SIGNED")) return { error: "This month is not waiting for signatures." };

  const asPresident = user.roles.includes("PRESIDENT") && !period.presidentSignedById;
  const asSecretary = !asPresident && user.roles.includes("SECRETARY") && !period.secretarySignedById;
  if (!asPresident && !asSecretary) return { error: "Your signature is already on this month." };
  if (period.presidentSignedById === user.id || period.secretarySignedById === user.id) return { error: "The two signatures must be from different people." };

  const now = new Date();
  const data = asPresident ? { presidentSignedById: user.id, presidentSignedAt: now } : { secretarySignedById: user.id, secretarySignedAt: now };
  const both = asPresident ? Boolean(period.secretarySignedById) : Boolean(period.presidentSignedById);

  await db.$transaction(async (tx) => {
    await tx.period.update({ where: { id: periodId }, data: { ...data, status: both ? "LOCKED" : "SIGNED", lockedAt: both ? now : null } });
    await audit({ userId: user.id, action: asPresident ? "month.sign_president" : "month.sign_secretary", table: "Period", recordId: periodId }, tx);
  });
  refresh();
  return {};
}

/** Admin reopens the most recently closed month: interest charges reversed, signatures cleared. */
export async function reopenMonth(periodId: string, _prev: CloseState, form: FormData): Promise<CloseState> {
  const user = await actionUser("ADMIN");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 10) return { error: "Give the reason for reopening (at least 10 characters)." };
  const period = await db.period.findUnique({ where: { id: periodId } });
  if (!period || period.status === "OPEN") return { error: "This month is already open." };
  const laterClosed = await db.period.findFirst({ where: { yearId: period.yearId, month: { gt: period.month }, status: { not: "OPEN" } } });
  if (laterClosed) return { error: `Reopen ${monthLabel(laterClosed.month)} first. Months are reopened from the latest.` };

  await db.$transaction(async (tx) => {
    const charges = await tx.ledgerEntry.findMany({ where: { periodId, type: "INTEREST_CHARGED", reversedBy: { is: null } } });
    for (const c of charges) {
      await tx.ledgerEntry.create({
        data: { date: c.date, periodId, memberId: c.memberId, loanId: c.loanId, type: "REVERSAL", amountKobo: c.amountKobo, reversesId: c.id, note: `Month reopened: ${reason}`, enteredById: user.id },
      });
    }
    await tx.loanMonth.deleteMany({ where: { periodId } });
    await tx.period.update({
      where: { id: periodId },
      data: { status: "OPEN", readyById: null, presidentSignedById: null, presidentSignedAt: null, secretarySignedById: null, secretarySignedAt: null, lockedAt: null },
    });
    await audit({ userId: user.id, action: "month.reopen", table: "Period", recordId: periodId, reason, newValue: { chargesReversed: charges.length } }, tx);
  });
  refresh();
  return {};
}
