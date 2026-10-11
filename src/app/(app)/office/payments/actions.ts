"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { PAYMENT_ROLES, actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENTRY_LABELS } from "@/lib/ledger";
import { formatNairaSms, parseNaira } from "@/lib/money";
import { memberPosition } from "@/lib/loans";
import { loanPartErrors, partsList, paymentSms, postMemberPayment } from "@/lib/payments";
import { monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";

export type PaymentState = {
  errors?: Record<string, string>;
  values?: Record<string, string>;
  error?: string;
  saved?: { memberName: string; memberNo: string; lines: string[]; month: string; date: string };
};

function amount(raw: string, field: string, errors: Record<string, string>): bigint {
  if (!raw.trim()) return 0n;
  try {
    const kobo = parseNaira(raw);
    if (kobo < 0n) errors[field] = "The amount cannot be negative.";
    return kobo;
  } catch {
    errors[field] = "Enter an amount in naira, e.g. 10,000.";
    return 0n;
  }
}

export async function recordPayment(_prev: PaymentState, form: FormData): Promise<PaymentState> {
  const officer = await actionUser(...PAYMENT_ROLES);
  const values = Object.fromEntries(
    ["member", "date", "contribution", "coversMonths", "membershipFee", "interestPaid", "loanRepaid", "bankRef", "note"].map((k) => [k, String(form.get(k) ?? "")]),
  );
  const errors: Record<string, string> = {};

  // The member box holds "IPU-0007 · Name"; only the number matters.
  const memberNo = /IPU-\d+/i.exec(values.member)?.[0]?.toUpperCase();
  const member = memberNo ? await db.member.findUnique({ where: { memberNo } }) : null;
  if (!member) errors.member = "Choose a member from the list.";
  else if (member.status === "EXITED") errors.member = "This member has exited the union.";
  else if (member.userId === officer.id) errors.member = "You cannot record a payment for yourself. Ask another officer.";

  const date = parseDateInput(values.date);
  if (!date) errors.date = "Enter the date the money reached the bank.";
  else if (values.date > todayLagos()) errors.date = "The date cannot be in the future.";

  const contribution = amount(values.contribution, "contribution", errors);
  const membershipFee = amount(values.membershipFee, "membershipFee", errors);
  const interestPaid = amount(values.interestPaid, "interestPaid", errors);
  const loanRepaid = amount(values.loanRepaid, "loanRepaid", errors);
  if (!Object.keys(errors).some((k) => k !== "member" && k !== "date") && contribution + membershipFee + interestPaid + loanRepaid === 0n) {
    errors.contribution = "Enter at least one amount.";
  }

  const position = member ? await memberPosition(member.id) : null;
  if (position) Object.assign(errors, loanPartErrors(position, { interestPaid, loanRepaid }));

  const period = date ? await periodFor(date) : null;
  if (date && !errors.date) {
    if (!period) errors.date = "That date is outside the open financial year.";
    else if (period.status !== "OPEN") errors.date = `${monthLabel(period.month)} is closed. Ask the Admin to reopen it.`;
  }
  // A contribution paid ahead can cover this month and following ones, up to February.
  const coversMonths = Math.max(1, Math.min(12, Number(values.coversMonths) || 1));
  if (period && coversMonths > 1) {
    const monthsLeft = 12 - ((period.month.getUTCMonth() + 10) % 12); // March = 12 left … February = 1
    if (!contribution) errors.coversMonths = "Enter the contribution that covers these months.";
    else if (coversMonths > monthsLeft) errors.coversMonths = `Only ${monthsLeft} month${monthsLeft > 1 ? "s" : ""} left in this financial year (to February).`;
  }
  if (Object.keys(errors).length || !member || !date || !period) return { errors, values };

  const amounts = { contribution, membershipFee, interestPaid, loanRepaid, coversMonths };
  const parts = partsList(amounts);
  await db.$transaction((tx) =>
    postMemberPayment({ memberId: member.id, date, periodId: period.id, parts: amounts, bankRef: values.bankRef.trim(), note: values.note.trim(), officerId: officer.id }, tx),
  );
  await paymentSms(member, period.year, date, amounts);

  revalidatePath("/", "layout");
  return {
    saved: {
      memberName: member.fullName,
      memberNo: member.memberNo,
      lines: parts.map((p) => `${ENTRY_LABELS[p.type]}: ${formatNairaSms(p.kobo).replace("N", "₦")}${p.type === "CONTRIBUTION" && coversMonths > 1 ? `, covering ${coversMonths} months` : ""}`),
      month: monthLabel(period.month),
      date: values.date,
    },
  };
}

export type ReverseState = { ok?: boolean; error?: string };

/** Corrects a wrong entry by adding a reversal. The original stays in the ledger. */
export async function reverseEntry(entryId: string, _prev: ReverseState, form: FormData): Promise<ReverseState> {
  const officer = await actionUser("ADMIN", "TREASURER");
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "Say why this entry is wrong (at least 5 characters)." };

  const entry = await db.ledgerEntry.findUnique({ where: { id: entryId }, include: { period: true, reversedBy: true } });
  if (!entry) return { error: "Entry not found." };
  if (!["CONTRIBUTION", "MEMBERSHIP_FEE", "INTEREST_PAID", "LOAN_REPAID", "OTHER_INCOME", "EXPENSE"].includes(entry.type)) {
    return { error: "Only payments can be reversed here. Loan payouts and interest charges are corrected by reopening the month." };
  }
  if (entry.reversedBy) return { error: "This entry was already reversed." };
  if (entry.period.status !== "OPEN") return { error: `${monthLabel(entry.period.month)} is closed. Ask the Admin to reopen it.` };

  await db.$transaction(async (tx) => {
    const reversal = await tx.ledgerEntry.create({
      data: {
        date: entry.date,
        periodId: entry.periodId,
        memberId: entry.memberId,
        type: "REVERSAL",
        amountKobo: entry.amountKobo,
        reversesId: entry.id,
        note: reason,
        enteredById: officer.id,
      },
    });
    await audit({ userId: officer.id, action: "payment.reverse", table: "LedgerEntry", recordId: entry.id, newValue: reversal, reason }, tx);
    // Undoing a repayment can mean a loan marked "repaid" is owed again.
    if (entry.memberId && (entry.type === "LOAN_REPAID" || entry.type === "INTEREST_PAID")) {
      const pos = await memberPosition(entry.memberId, undefined, tx);
      if (pos.principal > 0n || pos.interestOwed > 0n) {
        const last = await tx.loan.findFirst({ where: { borrowerId: entry.memberId, status: "CLOSED" }, orderBy: { closedAt: "desc" } });
        if (last) await tx.loan.update({ where: { id: last.id }, data: { status: "DISBURSED", closedAt: null } });
      }
    }
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
