"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseNaira } from "@/lib/money";
import { monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";

export type BankState = { errors?: Record<string, string>; error?: string; done?: string };

const refresh = () => revalidatePath("/", "layout");

function money(form: FormData, field: string, errors: Record<string, string>, required = true) {
  const raw = String(form.get(field) ?? "").trim();
  if (!raw) {
    if (required) errors[field] = "Enter the amount.";
    return 0n;
  }
  try {
    const k = parseNaira(raw);
    if (k <= 0n) errors[field] = "Must be more than ₦0.";
    return k;
  } catch {
    errors[field] = "Enter an amount in naira, e.g. 250,000.";
    return 0n;
  }
}

/** A bank date must fall in an open month and not in the future. */
async function openDate(form: FormData, field: string, errors: Record<string, string>) {
  const text = String(form.get(field) ?? "");
  const date = parseDateInput(text);
  if (!date) {
    errors[field] = "Enter the date.";
    return null;
  }
  if (text > todayLagos()) {
    errors[field] = "The date cannot be in the future.";
    return null;
  }
  const period = await periodFor(date);
  if (!period) errors[field] = "That date is outside the open financial year.";
  else if (period.status !== "OPEN") errors[field] = `${monthLabel(period.month)} is closed. Ask the Admin to reopen it.`;
  return period && period.status === "OPEN" ? { date, period } : null;
}

/** Treasurer records money in (other income) or out (expense, e.g. bank charges, SMS bundle). */
export async function recordIncomeOrExpense(_prev: BankState, form: FormData): Promise<BankState> {
  const user = await actionUser("TREASURER");
  const errors: Record<string, string> = {};
  const kind = String(form.get("kind") ?? "");
  if (kind !== "OTHER_INCOME" && kind !== "EXPENSE") errors.kind = "Choose money in or money out.";
  const amount = money(form, "amount", errors);
  const note = String(form.get("note") ?? "").trim();
  if (note.length < 3) errors.note = "Say what it was for.";
  const when = await openDate(form, "date", errors);
  if (Object.keys(errors).length || !when) return { errors };

  await db.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.create({
      data: { date: when.date, periodId: when.period.id, type: kind as "OTHER_INCOME" | "EXPENSE", amountKobo: amount, note, bankRef: String(form.get("bankRef") ?? "").trim() || null, enteredById: user.id },
    });
    await audit({ userId: user.id, action: kind === "EXPENSE" ? "bank.expense" : "bank.income", table: "LedgerEntry", recordId: entry.id, newValue: entry }, tx);
  });
  refresh();
  return { done: kind === "EXPENSE" ? "Expense recorded." : "Income recorded." };
}

/** Treasurer proposes an investment (MMF, treasury bill…); the President approves it before money moves. */
export async function proposeInvestment(_prev: BankState, form: FormData): Promise<BankState> {
  const user = await actionUser("TREASURER");
  const errors: Record<string, string> = {};
  const kind = String(form.get("kind") ?? "").trim();
  const institution = String(form.get("institution") ?? "").trim();
  if (!kind) errors.kind = "Choose the kind of investment.";
  if (institution.length < 2) errors.institution = "Enter the bank or fund manager.";
  const amount = money(form, "amount", errors);
  const rateText = String(form.get("rate") ?? "").trim();
  const rate = rateText ? Math.round(Number(rateText.replace("%", "")) * 100) : null;
  if (rateText && (!Number.isFinite(rate) || rate! <= 0 || rate! > 10000)) errors.rate = "Enter the yearly rate, e.g. 18.5.";
  const planned = parseDateInput(String(form.get("placedOn") ?? ""));
  if (!planned) errors.placedOn = "Enter the planned date.";
  const maturityText = String(form.get("maturityOn") ?? "");
  const maturity = maturityText ? parseDateInput(maturityText) : null;
  if (maturityText && (!maturity || (planned && maturity <= planned))) errors.maturityOn = "The maturity date must be after the placing date.";
  if (Object.keys(errors).length || !planned) return { errors };

  const inv = await db.investment.create({
    data: { kind, institution, amountPlacedKobo: amount, rateBps: rate, placedOn: planned, maturityOn: maturity, note: String(form.get("note") ?? "").trim() || null, treasurerApprovedById: user.id },
  });
  await audit({ userId: user.id, action: "investment.propose", table: "Investment", recordId: inv.id, newValue: inv });
  refresh();
  return { done: "Proposed. The President must approve it before the money is moved." };
}

export async function decideInvestment(investmentId: string, _prev: BankState, form: FormData): Promise<BankState> {
  const user = await actionUser("PRESIDENT");
  const inv = await db.investment.findUnique({ where: { id: investmentId } });
  if (!inv || inv.status !== "PROPOSED" || inv.presidentApprovedById) return { error: "This investment is not waiting for approval." };
  if (inv.treasurerApprovedById === user.id) return { error: "The person who proposed it cannot also approve it." };
  const approve = form.get("decision") === "approve";
  await db.$transaction(async (tx) => {
    await tx.investment.update({ where: { id: inv.id }, data: approve ? { presidentApprovedById: user.id } : { status: "CANCELLED" } });
    await audit({ userId: user.id, action: approve ? "investment.approve" : "investment.decline", table: "Investment", recordId: inv.id }, tx);
  });
  refresh();
  return {};
}

/** Treasurer records the transfer out of GT Bank once approved. */
export async function placeInvestment(investmentId: string, _prev: BankState, form: FormData): Promise<BankState> {
  const user = await actionUser("TREASURER");
  const inv = await db.investment.findUnique({ where: { id: investmentId } });
  if (!inv || inv.status !== "PROPOSED" || !inv.presidentApprovedById) return { error: "The President has not approved this investment yet." };
  const errors: Record<string, string> = {};
  const when = await openDate(form, "date", errors);
  if (Object.keys(errors).length || !when) return { errors };
  await db.$transaction(async (tx) => {
    await tx.investment.update({ where: { id: inv.id }, data: { status: "ACTIVE", placedOn: when.date } });
    const entry = await tx.ledgerEntry.create({
      data: { date: when.date, periodId: when.period.id, type: "INVESTMENT_PLACED", amountKobo: inv.amountPlacedKobo, investmentId: inv.id, note: `${inv.kind}, ${inv.institution}`, bankRef: String(form.get("bankRef") ?? "").trim() || null, enteredById: user.id },
    });
    await audit({ userId: user.id, action: "investment.place", table: "Investment", recordId: inv.id, newValue: entry }, tx);
  });
  refresh();
  return {};
}

/** Treasurer records the money coming back (principal plus profit). */
export async function returnInvestment(investmentId: string, _prev: BankState, form: FormData): Promise<BankState> {
  const user = await actionUser("TREASURER");
  const inv = await db.investment.findUnique({ where: { id: investmentId } });
  if (!inv || inv.status !== "ACTIVE") return { error: "This investment is not active." };
  const errors: Record<string, string> = {};
  const amount = money(form, "amount", errors);
  const when = await openDate(form, "date", errors);
  if (when && when.date < inv.placedOn) errors.date = "The return date is before the money was placed.";
  if (Object.keys(errors).length || !when) return { errors };
  await db.$transaction(async (tx) => {
    await tx.investment.update({ where: { id: inv.id }, data: { status: "MATURED", amountReturnedKobo: amount, returnedOn: when.date } });
    const entry = await tx.ledgerEntry.create({
      data: { date: when.date, periodId: when.period.id, type: "INVESTMENT_RETURNED", amountKobo: amount, investmentId: inv.id, note: `${inv.kind}, ${inv.institution}`, bankRef: String(form.get("bankRef") ?? "").trim() || null, enteredById: user.id },
    });
    await audit({ userId: user.id, action: "investment.return", table: "Investment", recordId: inv.id, newValue: entry }, tx);
  });
  refresh();
  return {};
}
