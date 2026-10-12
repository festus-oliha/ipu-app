"use server";

import { revalidatePath } from "next/cache";
import { DEFAULT_AFTER_MONTHS, interestArrearsMonths } from "@/lib/notices";
import type { FormResult } from "@/components/ActionForm";
import { audit } from "@/lib/audit";
import { PAYMENT_ROLES, actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOTICE_DAYS, owedOf, recoveryPlan } from "@/lib/debtors";
import { closeLoansIfCleared, memberPosition } from "@/lib/loans";
import { formatNaira, formatNairaSms } from "@/lib/money";
import { queueEmail, queueSms } from "@/lib/notify";
import { formatDate, parseDateInput, periodFor, todayLagos } from "@/lib/periods";

const refresh = () => revalidatePath("/", "layout");

export async function sendReminder(memberId: string): Promise<FormResult> {
  const user = await actionUser(...PAYMENT_ROLES);
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) return { error: "Member not found." };
  const p = await memberPosition(memberId);
  if (owedOf(p) <= 0n) return { error: "This member owes nothing." };
  await queueSms(member.phone, "debtor.manual", `IPU: Please pay what you owe: ${formatNairaSms(owedOf(p))} (loan ${formatNairaSms(p.principal)}${p.interestOwed > 0n ? `, interest ${formatNairaSms(p.interestOwed)}` : ""}). GT Bank 0033550876.`);
  await db.contactLog.create({ data: { memberId, channel: "SMS", outcome: "Reminder SMS sent", byId: user.id } });
  refresh();
  return { done: "Reminder sent." };
}

export async function logContact(memberId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser(...PAYMENT_ROLES);
  const channel = String(form.get("channel") ?? "");
  if (!["CALL", "SMS", "EMAIL", "IN_APP"].includes(channel)) return { errors: { channel: "Choose how you contacted them." } };
  const outcome = String(form.get("outcome") ?? "").trim();
  if (outcome.length < 3) return { errors: { outcome: "Write what was said or agreed." } };
  const promisedText = String(form.get("promisedOn") ?? "");
  const promisedOn = promisedText ? parseDateInput(promisedText) : null;
  if (promisedText && !promisedOn) return { errors: { promisedOn: "Enter a valid date." } };
  await db.contactLog.create({ data: { memberId, channel: channel as "CALL", outcome, promisedOn, byId: user.id } });
  refresh();
  return { done: "Contact recorded." };
}

/** President or Treasurer declares a default; the guarantor is told before any savings are used. */
export async function declareDefault(loanId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("PRESIDENT", "TREASURER");
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true } });
  if (!loan || loan.status !== "DISBURSED") return { error: "Only a paid-out loan can be declared in default." };
  if (loan.borrower.userId === user.id) return { error: "You cannot act on your own loan." };
  // Default only after interest has gone unpaid for two months in a row (year end is settled separately).
  const arrears = await interestArrearsMonths(loan.borrowerId);
  if (arrears < DEFAULT_AFTER_MONTHS) {
    return { error: `A loan can be declared in default only after ${DEFAULT_AFTER_MONTHS} months of unpaid interest. ${arrears ? `Interest is unpaid for ${arrears} month so far.` : "Interest is up to date."} Send a reminder or record contact instead.` };
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 10) return { errors: { reason: "Explain why (at least 10 characters), e.g. months unpaid and contact attempts." } };
  const p = await memberPosition(loan.borrowerId);
  const from = new Date(`${todayLagos()}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() + NOTICE_DAYS);

  await db.$transaction(async (tx) => {
    await tx.loan.update({ where: { id: loan.id }, data: { status: "DEFAULTED" } });
    await audit({ userId: user.id, action: "loan.default", table: "Loan", recordId: loan.id, reason, newValue: { owed: owedOf(p) } }, tx);
    // A verbal (unrecorded) guarantee from the workbook has nobody to notify or recover from.
    if (loan.guarantor) {
      await tx.contactLog.create({ data: { memberId: loan.guarantor.id, channel: "SMS", outcome: `Default notice for ${loan.borrower.fullName}'s loan`, byId: user.id } });
      const gText = `IPU: ${loan.borrower.fullName}'s loan, which you guarantee, is in default. Owed: ${formatNairaSms(owedOf(p))}. From ${formatDate(from)} it will be recovered from the borrower's savings, then yours. Please contact the Treasurer.`;
      await queueSms(loan.guarantor.phone, "default.guarantor", gText, tx);
      if (loan.guarantor.email) await queueEmail(loan.guarantor.email, "default.guarantor", "Loan you guarantee is in default", gText, tx);
    }
    await queueSms(loan.borrower.phone, "default.borrower", `IPU: Your loan is in default. You owe ${formatNairaSms(owedOf(p))}. From ${formatDate(from)} it will be taken from your savings, then your guarantor's. Pay now to avoid this.`, tx);
  });
  refresh();
  return { done: `Declared in default. Savings can be used from ${formatDate(from)}.` };
}

/** Treasurer takes the debt from savings once the notice period has passed. */
export async function recoverFromSavings(loanId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("TREASURER");
  const plan = await recoveryPlan(loanId);
  if (!plan || plan.loan.status !== "DEFAULTED") return { error: "This loan is not in default." };
  if (plan.loan.borrower.userId === user.id || plan.loan.guarantor?.userId === user.id) return { error: "Another officer must do this; it involves your own savings." };
  if (!plan.allowedFrom || new Date() < plan.allowedFrom) return { error: `The guarantor's notice runs until ${plan.allowedFrom ? formatDate(plan.allowedFrom) : "?"}.` };
  if (plan.fromBorrower + plan.fromGuarantor === 0n) return { error: "There are no savings to recover from." };
  if (form.get("confirm") !== "yes") return { errors: { confirm: "Tick to confirm." } };
  const today = todayLagos();
  const date = new Date(`${today}T00:00:00Z`);
  const period = await periodFor(date);
  if (!period || period.status !== "OPEN") return { error: "This month is closed; ask the Admin to reopen it." };

  const { loan, position } = plan;
  const total = plan.fromBorrower + plan.fromGuarantor;
  const interestPart = position.interestOwed > 0n ? (position.interestOwed < total ? position.interestOwed : total) : 0n;
  const loanPart = total - interestPart;
  const note = `Default recovery: ${formatNaira(plan.fromBorrower)} from borrower's savings, ${formatNaira(plan.fromGuarantor)} from guarantor ${loan.guarantor?.fullName ?? "(none recorded)"}`;

  await db.$transaction(async (tx) => {
    const row = (memberId: string, type: "DEDUCTION" | "INTEREST_DEDUCTED" | "LOAN_DEDUCTED", amountKobo: bigint, n: string) =>
      amountKobo > 0n ? tx.ledgerEntry.create({ data: { date, periodId: period.id, memberId, loanId: loan.id, type, amountKobo, note: n, enteredById: user.id } }) : null;
    await row(loan.borrowerId, "DEDUCTION", plan.fromBorrower, note);
    if (loan.guarantorId) await row(loan.guarantorId, "DEDUCTION", plan.fromGuarantor, `Guarantor for ${loan.borrower.fullName}: savings used to repay the loan`);
    await row(loan.borrowerId, "INTEREST_DEDUCTED", interestPart, note);
    await row(loan.borrowerId, "LOAN_DEDUCTED", loanPart, note);
    await closeLoansIfCleared(loan.borrowerId, tx);
    await audit({ userId: user.id, action: "loan.recover", table: "Loan", recordId: loan.id, newValue: { fromBorrower: plan.fromBorrower, fromGuarantor: plan.fromGuarantor, stillOwed: plan.stillOwed } }, tx);
    await queueSms(loan.borrower.phone, "default.recovered", `IPU: ${formatNairaSms(total)} has been taken from savings to repay your loan${plan.stillOwed > 0n ? `. You still owe ${formatNairaSms(plan.stillOwed)}` : ""}.`, tx);
    if (plan.fromGuarantor > 0n && loan.guarantor) await queueSms(loan.guarantor.phone, "default.recovered_guarantor", `IPU: ${formatNairaSms(plan.fromGuarantor)} of your savings was used for ${loan.borrower.fullName}'s loan, which you guaranteed.`, tx);
  });
  refresh();
  return { done: `Recovered ${formatNaira(total)}.${plan.stillOwed > 0n ? ` Still owed: ${formatNaira(plan.stillOwed)}.` : " The loan is cleared."}` };
}

export async function referToLegal(memberId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("ADMIN", "PRESIDENT");
  const notes = String(form.get("notes") ?? "").trim();
  if (notes.length < 10) return { errors: { notes: "Summarise the case (at least 10 characters)." } };
  const open = await db.legalReferral.findFirst({ where: { memberId, status: { not: "Closed" } } });
  if (open) return { error: "This member already has an open legal referral." };
  const r = await db.legalReferral.create({ data: { memberId, referredOn: new Date(`${todayLagos()}T00:00:00Z`), status: "Referred", notes, byId: user.id } });
  await audit({ userId: user.id, action: "legal.refer", table: "LegalReferral", recordId: r.id, newValue: r });
  refresh();
  return { done: "Referred for legal action." };
}

export async function updateLegal(referralId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("ADMIN", "PRESIDENT");
  const status = String(form.get("status") ?? "");
  if (!["Referred", "Letter sent", "In court", "Settled", "Closed"].includes(status)) return { errors: { status: "Choose a status." } };
  const note = String(form.get("note") ?? "").trim();
  const r = await db.legalReferral.findUnique({ where: { id: referralId } });
  if (!r) return { error: "Not found." };
  const notes = note ? `${r.notes ?? ""}\n${todayLagos()}: ${note}`.trim() : r.notes;
  await db.legalReferral.update({ where: { id: referralId }, data: { status, notes } });
  await audit({ userId: user.id, action: "legal.update", table: "LegalReferral", recordId: referralId, oldValue: r.status, newValue: { status, note } });
  refresh();
  return { done: "Updated." };
}
