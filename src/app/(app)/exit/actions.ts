"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { MEMBER_ADMIN_ROLES, actionUser, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { OPEN_LOAN_STATUSES, PENDING_STATUSES } from "@/lib/loans";
import { formatNaira, formatNairaSms } from "@/lib/money";
import { queueSms } from "@/lib/notify";
import { currentYear, monthLabel, parseDateInput, periodFor, todayLagos } from "@/lib/periods";
import { settle } from "@/lib/rules";
import { memberFigures, postDeductions } from "@/lib/settlement";

export type ExitState = { errors?: Record<string, string>; error?: string; done?: string };

const refresh = () => revalidatePath("/", "layout");

/** Reasons a member cannot leave yet, in plain words. */
async function blockers(memberId: string) {
  const [guaranteeing, pendingOwn] = await Promise.all([
    db.loan.findMany({ where: { guarantorId: memberId, status: { in: OPEN_LOAN_STATUSES } }, include: { borrower: true } }),
    db.loan.count({ where: { borrowerId: memberId, status: { in: PENDING_STATUSES } } }),
  ]);
  const out: string[] = [];
  for (const l of guaranteeing) out.push(`Is guarantor for ${l.borrower.fullName}'s loan of ${formatNaira(l.amountKobo)}; another guarantor must take over first.`);
  if (pendingOwn) out.push("Has a loan request in progress; it must be withdrawn or rejected first.");
  return out;
}

/** A member asks to leave (or the Admin/Secretary enters it for them). */
export async function requestExit(_prev: ExitState, form: FormData): Promise<ExitState> {
  const user = await requireUser();
  const memberNo = /IPU-\d+/i.exec(String(form.get("member") ?? ""))?.[0]?.toUpperCase();
  const forOther = Boolean(memberNo) && memberNo !== user.member?.memberNo;
  if (forOther && !hasRole(user, ...MEMBER_ADMIN_ROLES)) return { error: "Only the Admin or Secretary can enter an exit for another member." };
  const member = forOther ? await db.member.findUnique({ where: { memberNo } }) : user.member ? await db.member.findUnique({ where: { id: user.member.id } }) : null;
  if (!member) return { errors: { member: "Choose a member from the list." } };
  if (member.status === "EXITED") return { error: "This member has already left the union." };
  if (await db.exit.findFirst({ where: { memberId: member.id, status: { in: ["REQUESTED", "APPROVED"] } } })) return { error: "An exit request is already in progress." };
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 3) return { errors: { reason: "Give a short reason." } };
  const blocked = await blockers(member.id);
  if (blocked.length) return { error: blocked.join(" ") };

  const exit = await db.exit.create({ data: { memberId: member.id, reason, requestedById: user.id } });
  await audit({ userId: user.id, action: "exit.request", table: "Exit", recordId: exit.id, newValue: exit });
  refresh();
  return { done: "Exit request sent. The President or Treasurer will check the figures." };
}

/** President or Treasurer approves (figures fixed for the member to see) or rejects. */
export async function decideExit(exitId: string, _prev: ExitState, form: FormData): Promise<ExitState> {
  const user = await actionUser("PRESIDENT", "TREASURER");
  const exit = await db.exit.findUnique({ where: { id: exitId }, include: { member: true } });
  if (!exit || exit.status !== "REQUESTED") return { error: "This exit is not waiting for a decision." };
  if (exit.member.userId === user.id) return { error: "You cannot decide on your own exit." };
  const year = await currentYear();
  if (!year) return { error: "No open financial year." };

  if (form.get("decision") === "reject") {
    const reason = String(form.get("reason") ?? "").trim();
    if (reason.length < 5) return { errors: { reason: "Give the reason (at least 5 characters)." } };
    await db.$transaction(async (tx) => {
      await tx.exit.update({ where: { id: exit.id }, data: { status: "REJECTED", rejectReason: reason, approvedById: user.id } });
      await audit({ userId: user.id, action: "exit.reject", table: "Exit", recordId: exit.id, reason }, tx);
    });
    refresh();
    return {};
  }

  const blocked = await blockers(exit.memberId);
  if (blocked.length) return { error: blocked.join(" ") };
  const f = await memberFigures(exit.memberId, year);
  const s = settle({ contributions: f.savings, dividend: 0n, principal: f.position.principal, interestOwed: f.position.interestOwed });
  if (s.shortfall > 0n) return { error: `${exit.member.fullName} owes ${formatNaira(s.shortfall)} more than their savings. That must be paid before they can leave.` };

  await db.$transaction(async (tx) => {
    await tx.exit.update({
      where: { id: exit.id },
      data: { status: "APPROVED", approvedById: user.id, contributionsKobo: f.savings, deductionsKobo: s.interestDeducted + s.loanDeducted - s.credit, payoutKobo: s.payout },
    });
    await audit({ userId: user.id, action: "exit.approve", table: "Exit", recordId: exit.id, newValue: s }, tx);
  });
  refresh();
  return {};
}

/** Treasurer pays the member out: deductions posted, transfer recorded, member marked as exited. */
export async function payExit(exitId: string, _prev: ExitState, form: FormData): Promise<ExitState> {
  const user = await actionUser("TREASURER");
  const exit = await db.exit.findUnique({ where: { id: exitId }, include: { member: true } });
  if (!exit || exit.status !== "APPROVED") return { error: "This exit has not been approved." };
  if (exit.member.userId === user.id) return { error: "You cannot pay out your own exit." };
  const year = await currentYear();
  if (!year) return { error: "No open financial year." };

  const dateText = String(form.get("date") ?? "");
  const date = parseDateInput(dateText);
  const period = date ? await periodFor(date) : null;
  if (!date || dateText > todayLagos()) return { errors: { date: "Enter the date of the transfer (not in the future)." } };
  if (!period || period.status !== "OPEN") return { errors: { date: period ? `${monthLabel(period.month)} is closed.` : "That date is outside the open financial year." } };

  // Recompute: a payment may have arrived since approval.
  const f = await memberFigures(exit.memberId, year);
  const s = settle({ contributions: f.savings, dividend: 0n, principal: f.position.principal, interestOwed: f.position.interestOwed });
  if (s.shortfall > 0n) return { error: `The member now owes ${formatNaira(s.shortfall)} more than their savings.` };
  const bankRef = String(form.get("bankRef") ?? "").trim() || null;

  await db.$transaction(async (tx) => {
    await postDeductions({ memberId: exit.memberId, date, periodId: period.id, settled: s, officerId: user.id, note: "Exit: taken from savings" }, tx);
    if (s.payout > 0n) {
      await tx.ledgerEntry.create({ data: { date, periodId: period.id, memberId: exit.memberId, type: "PAYOUT", amountKobo: s.payout, bankRef, note: "Exit payout (contributions only, no dividend)", enteredById: user.id } });
    }
    await tx.exit.update({
      where: { id: exit.id },
      data: { status: "PAID", paidOn: date, bankRef, contributionsKobo: f.savings, deductionsKobo: s.interestDeducted + s.loanDeducted - s.credit, payoutKobo: s.payout },
    });
    await tx.member.update({ where: { id: exit.memberId }, data: { status: "EXITED", exitedAt: date } });
    await audit({ userId: user.id, action: "exit.pay", table: "Exit", recordId: exit.id, newValue: s }, tx);
    await queueSms(exit.member.phone, "exit.paid", `IPU: Your exit payout of ${formatNairaSms(s.payout)} has been sent to your bank. Thank you for your years with the union.`, tx);
  });
  refresh();
  return {};
}
