"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { PAYMENT_ROLES, actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ENTRY_LABELS, memberYearTotals } from "@/lib/ledger";
import { formatNairaSms, parseNaira } from "@/lib/money";
import { queueSms } from "@/lib/notify";
import { formatDate, monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";

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
    ["member", "date", "contribution", "membershipFee", "bankRef", "note"].map((k) => [k, String(form.get(k) ?? "")]),
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
  if (!errors.contribution && !errors.membershipFee && contribution === 0n && membershipFee === 0n) {
    errors.contribution = "Enter at least one amount.";
  }

  const period = date ? await periodFor(date) : null;
  if (date && !errors.date) {
    if (!period) errors.date = "That date is outside the open financial year.";
    else if (period.status !== "OPEN") errors.date = `${monthLabel(period.month)} is closed. Ask the Admin to reopen it.`;
  }
  if (Object.keys(errors).length || !member || !date || !period) return { errors, values };

  const parts = [
    { type: "CONTRIBUTION" as const, kobo: contribution },
    { type: "MEMBERSHIP_FEE" as const, kobo: membershipFee },
  ].filter((p) => p.kobo > 0n);

  await db.$transaction(async (tx) => {
    for (const p of parts) {
      const entry = await tx.ledgerEntry.create({
        data: {
          date,
          periodId: period.id,
          memberId: member.id,
          type: p.type,
          amountKobo: p.kobo,
          bankRef: values.bankRef.trim() || null,
          note: values.note.trim() || null,
          enteredById: officer.id,
        },
      });
      await audit({ userId: officer.id, action: "payment.record", table: "LedgerEntry", recordId: entry.id, newValue: entry }, tx);
    }
  });

  // SMS to the member with their new savings total (sent in phase 4).
  const totals = await memberYearTotals(member.id, period.year);
  const what = parts.map((p) => `${formatNairaSms(p.kobo)} ${ENTRY_LABELS[p.type].toLowerCase()}`).join(" + ");
  await queueSms(
    member.phone,
    "payment.recorded",
    `IPU: ${what} received ${formatDate(date)}. Savings this year: ${formatNairaSms(totals.contributions)}. Thank you.`,
  );

  revalidatePath("/", "layout");
  return {
    saved: {
      memberName: member.fullName,
      memberNo: member.memberNo,
      lines: parts.map((p) => `${ENTRY_LABELS[p.type]}: ${formatNairaSms(p.kobo).replace("N", "₦")}`),
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
  if (entry.type === "REVERSAL") return { error: "A reversal cannot itself be reversed." };
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
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
