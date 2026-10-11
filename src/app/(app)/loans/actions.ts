"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { MEMBER_ADMIN_ROLES, PAYMENT_ROLES, actionUser, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { activeGuarantees, memberPosition, pendingLoanTotal } from "@/lib/loans";
import { formatNairaSms, parseNaira } from "@/lib/money";
import { queueSms } from "@/lib/notify";
import { MONTH_NAMES, formatDate, monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";
import { DEFAULT_RULES, checkLoanRequest, monthlyInterest } from "@/lib/rules";

export type LoanFormState = { errors?: Record<string, string>; values?: Record<string, string>; error?: string };
export type StepState = { error?: string };

const memberNoOf = (text: string) => /IPU-\d+/i.exec(text)?.[0]?.toUpperCase();
const refresh = (loanId?: string) => {
  revalidatePath("/", "layout");
  if (loanId) revalidatePath(`/loans/${loanId}`);
};

// ───────────── 1. Request ─────────────

export async function requestLoan(_prev: LoanFormState, form: FormData): Promise<LoanFormState> {
  const user = await actionUser();
  const values = Object.fromEntries(["borrower", "guarantor", "amount", "purpose"].map((k) => [k, String(form.get(k) ?? "")]));
  const errors: Record<string, string> = {};
  const officer = hasRole(user, ...PAYMENT_ROLES, ...MEMBER_ADMIN_ROLES);

  // Members request for themselves; officers may enter a request from a paper form.
  const borrowerNo = officer && values.borrower ? memberNoOf(values.borrower) : user.member?.memberNo;
  const borrower = borrowerNo ? await db.member.findUnique({ where: { memberNo: borrowerNo } }) : null;
  if (!borrower) errors.borrower = officer ? "Choose the member asking for the loan." : "Your login is not linked to a member record. Ask the Secretary.";
  else if (borrower.status !== "ACTIVE") errors.borrower = "Only active members can borrow.";

  const guarantorNo = memberNoOf(values.guarantor);
  const guarantor = guarantorNo ? await db.member.findUnique({ where: { memberNo: guarantorNo } }) : null;
  if (!guarantor) errors.guarantor = "Choose a guarantor from the list.";
  else if (guarantor.status !== "ACTIVE") errors.guarantor = "The guarantor must be an active member.";

  let amount = 0n;
  try {
    amount = parseNaira(values.amount);
  } catch {
    errors.amount = "Enter an amount in naira, e.g. 150,000.";
  }
  if (values.purpose.trim().length < 3) errors.purpose = "Say briefly what the loan is for.";
  if (!borrower || !guarantor || Object.keys(errors).length) return { errors, values };

  const open = await db.loan.findFirst({ where: { borrowerId: borrower.id, status: { in: ["REQUESTED", "GUARANTOR_ACCEPTED", "PRESIDENT_APPROVED", "APPROVED"] } } });
  if (open) return { errors, values, error: "This member already has a loan request in progress. Finish or reject it first." };

  const position = await memberPosition(borrower.id);
  const check = checkLoanRequest({
    requested: amount,
    existingBalance: position.principal + (await pendingLoanTotal(borrower.id)),
    usualMonthly: borrower.usualMonthlyKobo,
    month: Number(todayLagos().slice(5, 7)),
    guarantorIsBorrower: guarantor.id === borrower.id,
    guarantorActiveGuarantees: await activeGuarantees(guarantor.id),
  });
  if (check.errors.length) {
    for (const e of check.errors) {
      if (/guarantor/i.test(e)) errors.guarantor = e;
      else if (/amount/i.test(e)) errors.amount = e;
      else return { errors, values, error: e };
    }
    return { errors, values };
  }

  const loan = await db.$transaction(async (tx) => {
    const created = await tx.loan.create({
      data: {
        borrowerId: borrower.id,
        guarantorId: guarantor.id,
        amountKobo: amount,
        purpose: values.purpose.trim(),
        isException: check.isException,
        requestedById: user.id,
      },
    });
    await audit({ userId: user.id, action: "loan.request", table: "Loan", recordId: created.id, newValue: created }, tx);
    await queueSms(
      guarantor.phone,
      "loan.guarantor_request",
      `IPU: ${borrower.fullName} asks you to guarantee a loan of ${formatNairaSms(amount)}. Sign in to the IPU app to accept or decline.`,
      tx,
    );
    return created;
  });

  refresh();
  redirect(`/loans/${loan.id}`);
}

// ───────────── 2. Guarantor ─────────────

export async function guarantorDecision(loanId: string, _prev: StepState, form: FormData): Promise<StepState> {
  const user = await actionUser();
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true } });
  if (!loan || loan.status !== "REQUESTED") return { error: "This request is no longer waiting for the guarantor." };

  const isGuarantor = user.member?.id === loan.guarantorId;
  const onPaper = !isGuarantor && hasRole(user, ...MEMBER_ADMIN_ROLES);
  if (!isGuarantor && !onPaper) return { error: "Only the guarantor (or the Secretary, from a signed form) can answer." };
  if (onPaper && user.member?.id === loan.borrowerId) return { error: "You cannot answer for your own loan." };

  const accept = form.get("decision") === "accept";
  const reason = String(form.get("reason") ?? "").trim() || null;

  await db.$transaction(async (tx) => {
    await tx.loanApproval.create({
      data: { loanId, step: "GUARANTOR", decision: accept ? "APPROVED" : "REJECTED", reason: onPaper ? `Recorded from signed paper form${reason ? `: ${reason}` : ""}` : reason, byId: user.id },
    });
    await tx.loan.update({ where: { id: loanId }, data: { status: accept ? "GUARANTOR_ACCEPTED" : "REJECTED" } });
    await audit({ userId: user.id, action: accept ? "loan.guarantor_accept" : "loan.guarantor_decline", table: "Loan", recordId: loanId, reason: reason ?? undefined }, tx);
    await queueSms(
      loan.borrower.phone,
      "loan.guarantor_answer",
      accept
        ? `IPU: ${loan.guarantor?.fullName ?? "Your guarantor"} has agreed to guarantee your loan request of ${formatNairaSms(loan.amountKobo)}. It now goes to the President.`
        : `IPU: ${loan.guarantor?.fullName ?? "Your guarantor"} declined to guarantee your loan request. You may ask another member.`,
      tx,
    );
  });
  refresh(loanId);
  return {};
}

// ───────────── 3 & 4. President, then Treasurer ─────────────

async function approvalStep(loanId: string, form: FormData, step: "PRESIDENT" | "TREASURER"): Promise<StepState> {
  const user = await actionUser(step);
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true, approvals: true } });
  const expected = step === "PRESIDENT" ? "GUARANTOR_ACCEPTED" : "PRESIDENT_APPROVED";
  if (!loan || loan.status !== expected) return { error: "This loan is not waiting for this approval." };
  if (user.member?.id === loan.borrowerId) return { error: "You cannot approve your own loan. Another officer must do it." };
  if (step === "TREASURER" && loan.approvals.some((a) => a.step === "PRESIDENT" && a.byId === user.id)) {
    return { error: "The same person cannot give both approvals." };
  }

  const approve = form.get("decision") === "approve";
  const reason = String(form.get("reason") ?? "").trim();
  if (!approve && reason.length < 5) return { error: "Give the reason for not approving (at least 5 characters)." };

  const exceptionDone = loan.approvals.some((a) => a.step === "EXCEPTION" && a.decision === "APPROVED");
  const approvesException = form.get("exception") === "on";
  if (approve && loan.isException && !exceptionDone && step === "TREASURER" && !approvesException) {
    return { error: "This loan is above the member's limit. Tick to approve it as an exception, or do not approve." };
  }
  if (approve && approvesException && reason.length < 5) return { error: "Give the reason for the exception (at least 5 characters)." };

  await db.$transaction(async (tx) => {
    await tx.loanApproval.create({ data: { loanId, step, decision: approve ? "APPROVED" : "REJECTED", reason: reason || null, byId: user.id } });
    if (approve && loan.isException && !exceptionDone && approvesException) {
      await tx.loanApproval.create({ data: { loanId, step: "EXCEPTION", decision: "APPROVED", reason, byId: user.id } });
      await tx.loan.update({ where: { id: loanId }, data: { exceptionReason: reason, guarantorToldAt: new Date() } });
      await queueSms(
        loan.guarantor?.phone ?? null,
        "loan.exception_guarantor",
        `IPU: The loan of ${formatNairaSms(loan.amountKobo)} to ${loan.borrower.fullName}, which you guarantee, is above their usual limit and was approved as an exception.`,
        tx,
      );
    }
    const next = !approve ? "REJECTED" : step === "PRESIDENT" ? "PRESIDENT_APPROVED" : "APPROVED";
    await tx.loan.update({ where: { id: loanId }, data: { status: next } });
    await audit({ userId: user.id, action: `loan.${step.toLowerCase()}_${approve ? "approve" : "reject"}`, table: "Loan", recordId: loanId, reason: reason || undefined }, tx);
    if (!approve) {
      await queueSms(loan.borrower.phone, "loan.rejected", `IPU: Your loan request of ${formatNairaSms(loan.amountKobo)} was not approved. Reason: ${reason}`, tx);
    } else if (next === "APPROVED") {
      await queueSms(loan.borrower.phone, "loan.approved", `IPU: Your loan of ${formatNairaSms(loan.amountKobo)} is approved. The Treasurer will pay it into your account.`, tx);
    }
  });
  refresh(loanId);
  return {};
}

export async function presidentDecision(loanId: string, _prev: StepState, form: FormData) {
  return approvalStep(loanId, form, "PRESIDENT");
}
export async function treasurerDecision(loanId: string, _prev: StepState, form: FormData) {
  return approvalStep(loanId, form, "TREASURER");
}

// ───────────── 5. Pay out ─────────────

export async function disburseLoan(loanId: string, _prev: StepState, form: FormData): Promise<StepState> {
  const user = await actionUser("TREASURER");
  const loan = await db.loan.findUnique({ where: { id: loanId }, include: { borrower: true, guarantor: true } });
  if (!loan || loan.status !== "APPROVED") return { error: "This loan is not approved for payout." };
  if (user.member?.id === loan.borrowerId) return { error: "You cannot pay out your own loan." };

  const dateText = String(form.get("date") ?? "");
  const bankRef = String(form.get("bankRef") ?? "").trim();
  const date = parseDateInput(dateText);
  if (!date) return { error: "Enter the date the money left the bank." };
  if (dateText > todayLagos()) return { error: "The date cannot be in the future." };
  if (!DEFAULT_RULES.loanMonths.includes(date.getUTCMonth() + 1)) return { error: "Loans are paid out from March to December only." };
  if (bankRef.length < 3) return { error: "Enter the bank transfer reference." };
  const period = await periodFor(date);
  if (!period) return { error: "That date is outside the open financial year." };
  if (period.status !== "OPEN") return { error: `${monthLabel(period.month)} is closed. Ask the Admin to reopen it.` };

  const due = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 15));
  const firstInterest = monthlyInterest(loan.amountKobo);

  await db.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.create({
      data: { date, periodId: period.id, memberId: loan.borrowerId, type: "LOAN_GIVEN", amountKobo: loan.amountKobo, loanId, bankRef, enteredById: user.id },
    });
    await tx.loan.update({ where: { id: loanId }, data: { status: "DISBURSED", disbursedOn: date, bankRef } });
    await audit({ userId: user.id, action: "loan.disburse", table: "Loan", recordId: loanId, newValue: entry }, tx);
    await queueSms(
      loan.borrower.phone,
      "loan.disbursed",
      `IPU: Loan of ${formatNairaSms(loan.amountKobo)} paid to you on ${formatDate(date)}. Interest of ${formatNairaSms(firstInterest)} is due by 15 ${MONTH_NAMES[due.getUTCMonth()]}.`,
      tx,
    );
    await queueSms(
      loan.guarantor?.phone ?? null,
      "loan.disbursed_guarantor",
      `IPU: The loan of ${formatNairaSms(loan.amountKobo)} to ${loan.borrower.fullName}, which you guarantee, was paid out on ${formatDate(date)}.`,
      tx,
    );
  });
  refresh(loanId);
  return {};
}
