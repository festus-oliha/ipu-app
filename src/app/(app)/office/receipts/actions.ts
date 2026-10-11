"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { PAYMENT_ROLES, actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { memberPosition } from "@/lib/loans";
import { formatNairaSms, parseNaira } from "@/lib/money";
import { queueSms } from "@/lib/notify";
import { loanPartErrors, paymentSms, postMemberPayment } from "@/lib/payments";
import { formatDate, monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";

export type ReviewState = { errors?: Record<string, string>; error?: string; done?: string };

const FIELDS = ["contribution", "membershipFee", "interestPaid", "loanRepaid"] as const;

async function pendingReceipt(receiptId: string, officerId: string) {
  const receipt = await db.receipt.findUnique({ where: { id: receiptId }, include: { member: true } });
  if (!receipt || receipt.status !== "PENDING") return { error: "This receipt has already been checked." } as const;
  if (receipt.member.userId === officerId) return { error: "You cannot check your own receipt. Ask another officer." } as const;
  return { receipt } as const;
}

/** Confirms a receipt (optionally with a corrected split): the money is posted like any payment. */
export async function confirmReceipt(receiptId: string, _prev: ReviewState, form: FormData): Promise<ReviewState> {
  const officer = await actionUser(...PAYMENT_ROLES);
  const found = await pendingReceipt(receiptId, officer.id);
  if ("error" in found) return { error: found.error };
  const { receipt } = found;

  const errors: Record<string, string> = {};
  const amounts = { contribution: 0n, membershipFee: 0n, interestPaid: 0n, loanRepaid: 0n };
  for (const f of FIELDS) {
    const raw = String(form.get(f) ?? "").trim();
    if (!raw) continue;
    try {
      amounts[f] = parseNaira(raw);
      if (amounts[f] < 0n) errors[f] = "Cannot be negative.";
    } catch {
      errors[f] = "Enter an amount in naira.";
    }
  }
  if (!Object.keys(errors).length && FIELDS.every((f) => amounts[f] === 0n)) errors.contribution = "Enter at least one amount, or reject the receipt.";

  const dateText = String(form.get("date") ?? "");
  const date = parseDateInput(dateText);
  const period = date ? await periodFor(date) : null;
  if (!date) errors.date = "Enter the date the money reached the bank.";
  else if (dateText > todayLagos()) errors.date = "The date cannot be in the future.";
  else if (!period) errors.date = "That date is outside the open financial year.";
  else if (period.status !== "OPEN") errors.date = `${monthLabel(period.month)} is closed. Ask the Admin to reopen it.`;

  Object.assign(errors, loanPartErrors(await memberPosition(receipt.memberId), amounts));
  if (Object.keys(errors).length || !date || !period) return { errors };

  const resplit =
    amounts.contribution !== receipt.contributionKobo || amounts.membershipFee !== receipt.otherKobo ||
    amounts.interestPaid !== receipt.interestKobo || amounts.loanRepaid !== receipt.repaymentKobo;

  await db.$transaction(async (tx) => {
    const claimed = await tx.receipt.updateMany({
      where: { id: receipt.id, status: "PENDING" },
      data: {
        status: "CONFIRMED",
        checkedById: officer.id,
        checkedAt: new Date(),
        paidOn: date,
        amountKobo: FIELDS.reduce((t, f) => t + amounts[f], 0n),
        contributionKobo: amounts.contribution,
        otherKobo: amounts.membershipFee,
        interestKobo: amounts.interestPaid,
        repaymentKobo: amounts.loanRepaid,
      },
    });
    if (claimed.count !== 1) throw new Error("This receipt was checked by someone else just now.");
    await postMemberPayment(
      { memberId: receipt.memberId, date, periodId: period.id, parts: amounts, bankRef: String(form.get("bankRef") ?? "").trim(), note: "From uploaded receipt", receiptId: receipt.id, officerId: officer.id },
      tx,
    );
    await audit({ userId: officer.id, action: resplit ? "receipt.confirm_resplit" : "receipt.confirm", table: "Receipt", recordId: receipt.id, oldValue: receipt, newValue: amounts }, tx);
  });
  await paymentSms(receipt.member, period.year, date, amounts);
  revalidatePath("/", "layout");
  return { done: `Confirmed for ${receipt.member.fullName}.` };
}

export async function rejectReceipt(receiptId: string, _prev: ReviewState, form: FormData): Promise<ReviewState> {
  const officer = await actionUser(...PAYMENT_ROLES);
  const found = await pendingReceipt(receiptId, officer.id);
  if ("error" in found) return { error: found.error };
  const { receipt } = found;
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5) return { errors: { reason: "Tell the member why (at least 5 characters)." } };

  await db.$transaction(async (tx) => {
    await tx.receipt.update({ where: { id: receipt.id }, data: { status: "REJECTED", rejectReason: reason, checkedById: officer.id, checkedAt: new Date() } });
    await audit({ userId: officer.id, action: "receipt.reject", table: "Receipt", recordId: receipt.id, reason }, tx);
    await queueSms(receipt.member.phone, "receipt.rejected", `IPU: Your receipt of ${formatNairaSms(receipt.amountKobo)} dated ${formatDate(receipt.paidOn)} was not accepted: ${reason}`, tx);
  });
  revalidatePath("/", "layout");
  return { done: `Rejected. ${receipt.member.fullName} gets an SMS with the reason.` };
}
