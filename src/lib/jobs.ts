import "server-only";
import { audit } from "./audit";
import { db } from "./db";
import { buildBackupWorkbook } from "./exportWorkbook";
import { positionsThrough } from "./loans";
import { sendEmail } from "./messaging";
import { formatNaira, formatNairaSms } from "./money";
import { flushOutbox, queueEmail, queueSms } from "./notify";
import { MONTH_NAMES, formatDate, todayLagos } from "./periods";

/**
 * The daily jobs from System Design §5. The hourly scheduler calls runJobs();
 * each job decides whether today (Lagos time) is its day, and a job that has
 * already run for its date is skipped, so running every hour is safe.
 */

const FAR = new Date(Date.UTC(2100, 0, 1));

type Today = { iso: string; y: number; m: number; d: number; lastDay: boolean };

function parseToday(iso: string): Today {
  const [y, m, d] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate() === d;
  return { iso, y, m, d, lastDay };
}

/** Runs `fn` once per key; returns what it reported, or null if already done. */
async function once(job: string, key: string, fn: () => Promise<string>) {
  const done = await db.auditLog.findFirst({ where: { action: `job.${job}`, recordId: key } });
  if (done) return null;
  // Record first, so an overlapping run cannot start the same job twice.
  const mark = await db.auditLog.create({ data: { action: `job.${job}`, table: "Job", recordId: key } });
  try {
    const summary = await fn();
    await db.auditLog.update({ where: { id: mark.id }, data: { newValue: { summary } } });
    return `${job}: ${summary}`;
  } catch (e) {
    await db.auditLog.delete({ where: { id: mark.id } }); // try again next hour
    throw e;
  }
}

const memberName = (m: { title: string | null; fullName: string }) => [m.title, m.fullName].filter(Boolean).join(" ");

async function borrowersOwingInterest() {
  const positions = await positionsThrough(FAR);
  const ids = [...positions].filter(([, p]) => p.interestOwed > 0n).map(([id]) => id);
  const members = await db.member.findMany({ where: { id: { in: ids }, status: { not: "EXITED" } } });
  return members.map((m) => ({ member: m, pos: positions.get(m.id)! }));
}

const JOBS: { name: string; due: (t: Today) => string | null; run: (t: Today) => Promise<string> }[] = [
  {
    // 10th: reminder to borrowers who still owe interest due on the 15th.
    name: "interest.reminder",
    due: (t) => (t.d === 10 ? t.iso.slice(0, 7) : null),
    run: async (t) => {
      const list = await borrowersOwingInterest();
      for (const { member, pos } of list) {
        await queueSms(member.phone, "interest.reminder", `IPU: Reminder: interest of ${formatNairaSms(pos.interestOwed)} is due by 15 ${MONTH_NAMES[t.m - 1]}. Pay into GT Bank 0033550876.`);
      }
      return `${list.length} reminder(s)`;
    },
  },
  {
    // 16th: unpaid interest is now arrears; borrower and guarantor are told.
    name: "interest.arrears",
    due: (t) => (t.d === 16 ? t.iso.slice(0, 7) : null),
    run: async () => {
      const list = await borrowersOwingInterest();
      for (const { member, pos } of list) {
        await queueSms(member.phone, "interest.arrears", `IPU: Interest of ${formatNairaSms(pos.interestOwed)} was not paid by the 15th. It is now arrears and is added to next month's interest (no penalty).`);
        const loan = await db.loan.findFirst({ where: { borrowerId: member.id, status: "DISBURSED" }, include: { guarantor: true }, orderBy: { disbursedOn: "desc" } });
        if (loan?.guarantor && loan.guarantor.status !== "EXITED") {
          const text = `IPU: ${memberName(member)}, whose loan you guarantee, has not paid interest of ${formatNairaSms(pos.interestOwed)} due on the 15th. Loan balance: ${formatNairaSms(pos.principal)}.`;
          await queueSms(loan.guarantor.phone, "guarantor.arrears", text);
          if (loan.guarantor.email) await queueEmail(loan.guarantor.email, "guarantor.arrears", "Loan you guarantee: interest unpaid", `${text}\n\nIyobor Progressive Union\n198, Old Sapele Road, Benin City · +234 907 672 9480`);
        }
      }
      return `${list.length} borrower(s) in arrears`;
    },
  },
  {
    // 1st and 15th, December to 15 February: what will be taken from savings at year end.
    name: "yearend.warning",
    due: (t) => ((t.m === 12 || t.m === 1 || t.m === 2) && (t.d === 1 || t.d === 15) ? t.iso : null),
    run: async () => {
      const positions = await positionsThrough(FAR);
      const ids = [...positions].filter(([, p]) => p.principal > 0n || p.interestOwed > 0n).map(([id]) => id);
      const members = await db.member.findMany({ where: { id: { in: ids }, status: { not: "EXITED" } } });
      for (const m of members) {
        const p = positions.get(m.id)!;
        const owed = p.principal + (p.interestOwed > 0n ? p.interestOwed : 0n);
        await queueSms(m.phone, "yearend.warning", `IPU: Year end is near. You owe ${formatNairaSms(owed)} (loan ${formatNairaSms(p.principal)}). Anything unpaid by end of February is taken from your savings.`);
      }
      return `${members.length} warning(s)`;
    },
  },
  {
    // Last day of May, August, November and February: guarantors get a progress report.
    name: "guarantor.quarterly",
    due: (t) => ([5, 8, 11, 2].includes(t.m) && t.lastDay ? t.iso.slice(0, 7) : null),
    run: async () => {
      const loans = await db.loan.findMany({ where: { status: { in: ["DISBURSED", "DEFAULTED"] } }, include: { borrower: true, guarantor: true } });
      const positions = await positionsThrough(FAR);
      for (const l of loans) {
        if (!l.guarantor || l.guarantor.status === "EXITED") continue; // verbal guarantee: nobody on record
        const p = positions.get(l.borrowerId) ?? { principal: 0n, interestOwed: 0n };
        const body = [
          `Dear ${memberName(l.guarantor)},`,
          "",
          `This is the quarterly report on the loan you guarantee for ${memberName(l.borrower)} (${l.borrower.memberNo}).`,
          `Loan amount: ${formatNaira(l.amountKobo)}, paid out ${l.disbursedOn ? formatDate(l.disbursedOn) : ""}.`,
          `Loan balance today: ${formatNaira(p.principal)}.`,
          p.interestOwed > 0n ? `Interest unpaid: ${formatNaira(p.interestOwed)}.` : "Interest: up to date.",
          "",
          "If the borrower cannot pay, the union first uses the borrower's own savings, then the guarantor's.",
          "",
          "Iyobor Progressive Union · 198, Old Sapele Road, Benin City · +234 907 672 9480 · iyoborpu@gmail.com",
        ].join("\n");
        if (l.guarantor.email) await queueEmail(l.guarantor.email, "guarantor.quarterly", `Quarterly loan report: ${memberName(l.borrower)}`, body);
        else await queueSms(l.guarantor.phone, "guarantor.quarterly", `IPU: Loan you guarantee for ${memberName(l.borrower)}: balance ${formatNairaSms(p.principal)}${p.interestOwed > 0n ? `, interest unpaid ${formatNairaSms(p.interestOwed)}` : ", interest up to date"}.`);
      }
      return `${loans.length} report(s)`;
    },
  },
  {
    // Every day: investments maturing in 7 days are flagged to the Treasurer.
    name: "investment.maturity",
    due: (t) => t.iso,
    run: async (t) => {
      const in7 = new Date(Date.UTC(t.y, t.m - 1, t.d + 7));
      const due = await db.investment.findMany({ where: { status: "ACTIVE", maturityOn: in7 } });
      if (!due.length) return "none";
      const treasurers = await db.user.findMany({ where: { roles: { some: { role: "TREASURER" } } }, include: { member: true } });
      for (const i of due) {
        for (const u of treasurers) {
          const text = `IPU: ${i.kind} at ${i.institution} (${formatNairaSms(i.amountPlacedKobo)}) matures on ${formatDate(in7)}. Record the return in the app when the money is back.`;
          await queueSms(u.phone, "investment.maturity", text);
          if (u.member?.email) await queueEmail(u.member.email, "investment.maturity", "Investment matures in 7 days", text);
        }
      }
      return `${due.length} investment(s)`;
    },
  },
  {
    // 1st and 15th: debtors on a pay-up plan are reminded of their date.
    name: "debtor.reminder",
    due: (t) => (t.d === 1 || t.d === 15 ? t.iso : null),
    run: async () => {
      const list = await db.settlement.findMany({ where: { result: "DEBTOR", debtorPlan: "PAY_UP" }, include: { member: true } });
      const positions = await positionsThrough(FAR);
      let n = 0;
      for (const s of list) {
        const p = positions.get(s.memberId);
        if (!p || (p.principal <= 0n && p.interestOwed <= 0n) || s.member.status === "EXITED") continue;
        n++;
        await queueSms(s.member.phone, "debtor.reminder", `IPU: You still owe ${formatNairaSms(p.principal + (p.interestOwed > 0n ? p.interestOwed : 0n))}. Please pay by ${s.debtorDueOn ? formatDate(s.debtorDueOn) : "the agreed date"} into GT Bank 0033550876.`);
      }
      return `${n} reminder(s)`;
    },
  },
  {
    // 1 and 20 February: remind the Admin to open next year's months before 1 March.
    name: "year.open_reminder",
    due: (t) => (t.m === 2 && (t.d === 1 || t.d === 20) ? t.iso : null),
    run: async (t) => {
      const next = await db.financialYear.findFirst({ where: { startDate: new Date(Date.UTC(t.y, 2, 1)) } });
      if (next) return "already open";
      const admins = await db.user.findMany({ where: { roles: { some: { role: "ADMIN" } } } });
      for (const a of admins) await queueSms(a.phone, "year.open_reminder", `IPU app: please open the ${t.y}–${t.y + 1} year (Year end page) before 1 March so March payments can be recorded.`);
      return `${admins.length} reminder(s)`;
    },
  },
  {
    // 1st of each month: a full Excel copy of the records emailed to the Admin.
    name: "backup.monthly",
    due: (t) => (t.d === 1 ? t.iso.slice(0, 7) : null),
    run: async (t) => {
      const admins = await db.user.findMany({ where: { roles: { some: { role: "ADMIN" } } }, include: { member: true } });
      const to = [...new Set([process.env.BACKUP_EMAIL, ...admins.map((a) => a.member?.email)].filter((x): x is string => Boolean(x)))];
      if (!to.length) return "no Admin email on record";
      const file = await buildBackupWorkbook();
      const r = await sendEmail(to.join(","), `IPU records backup ${t.iso}`, "The full records of the union as an Excel file, sent automatically on the 1st of each month. Keep it safe; it contains members' phone numbers and bank details.", [
        { filename: `IPU-backup-${t.iso}.xlsx`, content: file },
      ]);
      if (!r.ok && r.retry) throw new Error(r.error);
      return r.ok ? `sent to ${to.length}` : r.error;
    },
  },
];

export async function runJobs(now = todayLagos()) {
  const t = parseToday(now);
  const ran: string[] = [];
  for (const job of JOBS) {
    const key = job.due(t);
    if (!key) continue;
    try {
      const r = await once(job.name, key, () => job.run(t));
      if (r) ran.push(r);
    } catch (e) {
      ran.push(`${job.name}: FAILED ${(e as Error).message}`);
    }
  }
  const outbox = await flushOutbox(200, Date.now() + 15_000);
  return { today: now, ran, outbox };
}

export async function recordManualRun(userId: string, result: Awaited<ReturnType<typeof runJobs>>) {
  await audit({ userId, action: "jobs.run_now", table: "Job", recordId: result.today, newValue: result });
}
