/**
 * Loads a year's records from the union's Excel workbook into the app.
 *
 *   npm run import:workbook -- "<workbook.xlsx>"            dry run: nothing is saved
 *   npm run import:workbook -- "<workbook.xlsx>" --commit   saves (after a clean dry run)
 *
 * The first run writes import/<workbook>.json with what the workbook does not
 * say (phone numbers, usual monthly amount, guarantors). Fill it in and run
 * again. The import/ folder holds personal data and is never committed.
 *
 * What is imported: each member's monthly payment (column C), loan given (D),
 * interest paid (G) and loan returned (I), for every month that has figures.
 * Interest is NOT copied from the workbook: the app works it out with its own
 * tested rules (₦25 per ₦1,000 on the month-end balance) and closes each past
 * month, then the report compares its figures with the workbook's "New Interest"
 * (column K) and "Loan Balance" (column J) so every difference is explained.
 *
 * --commit also clears the trial data first (payments, loans, receipts,
 * messages…) but keeps every login and member, and the 2026–2027 months.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import { hash } from "@node-rs/argon2";
import { db } from "@/lib/db";
import { chargeInterest, expectedBank, OPENING_BANK_KEY } from "@/lib/monthClose";
import { loanLimit } from "@/lib/rules";
import { normalizePhone } from "@/lib/phone";
import { nextMemberNo } from "@/lib/memberInput";

// ───────────────────────── reading the workbook ─────────────────────────

const MONTHS = ["March", "April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February"];
const TITLES = ["Mrs", "Mr", "Miss", "Madam", "Chief", "Dr", "Pastor"];
const N = (naira: number) => BigInt(Math.round(naira * 100));
const fmt = (k: bigint) => `₦${(Number(k) / 100).toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function value(cell: ExcelJS.Cell): unknown {
  const v = cell.value as unknown;
  if (v && typeof v === "object" && "result" in (v as object)) return (v as { result: unknown }).result;
  if (v && typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
  return v;
}
const num = (cell: ExcelJS.Cell) => {
  const v = value(cell);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
};
const text = (cell: ExcelJS.Cell) => String(value(cell) ?? "").trim();

function splitName(raw: string) {
  const m = /^(Mrs|Mr|Miss|Madam|Chief|Dr|Pastor)\.?\s+(.*)$/i.exec(raw.trim());
  if (!m) return { title: "", fullName: raw.trim() };
  const title = TITLES.find((t) => t.toLowerCase() === m[1].toLowerCase()) ?? "";
  return { title, fullName: m[2].trim() };
}

type Row = { sn: number; name: string; c: number; d: number; g: number; i: number; j: number; k: number };
type Sheet = { month: string; index: number; rows: Row[]; totals: { c: number; d: number; g: number; i: number }; bank: number | null };

async function readWorkbook(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const records = wb.getWorksheet("Mem_Records");
  if (!records) throw new Error('No "Mem_Records" sheet in this workbook.');
  const people: { sn: number; name: string; phone: string; bank: string; account: string; year: string; occupation: string }[] = [];
  records.eachRow((r, n) => {
    if (n < 4) return;
    const sn = Number(text(r.getCell(1)));
    const name = text(r.getCell(2));
    if (sn && name) people.push({ sn, name, phone: text(r.getCell(3)), bank: text(r.getCell(4)), account: text(r.getCell(5)), year: text(r.getCell(6)), occupation: text(r.getCell(7)) });
  });

  // Which year? From "Monthly Contribution Amortization for March 2026".
  const march = wb.getWorksheet("March");
  const yearMatch = /(\d{4})/.exec(text(march?.getCell("A2") ?? ({} as ExcelJS.Cell)));
  if (!yearMatch) throw new Error("Could not find the year in March!A2.");
  const startYear = Number(yearMatch[1]);

  const sheets: Sheet[] = [];
  MONTHS.forEach((month, index) => {
    const ws = wb.getWorksheet(month);
    if (!ws) return;
    const rows: Row[] = [];
    for (let r = 5; r <= 36; r++) {
      const row = ws.getRow(r);
      const sn = Number(text(row.getCell(1)));
      const name = text(row.getCell(2));
      if (!sn || !name) continue;
      rows.push({ sn, name, c: num(row.getCell(3)), d: num(row.getCell(4)), g: num(row.getCell(7)), i: num(row.getCell(9)), j: num(row.getCell(10)), k: num(row.getCell(11)) });
    }
    const t = ws.getRow(38);
    const bankCell = ws.getCell("I44");
    sheets.push({ month, index, rows, totals: { c: num(t.getCell(3)), d: num(t.getCell(4)), g: num(t.getCell(7)), i: num(t.getCell(9)) }, bank: typeof value(bankCell) === "number" ? num(bankCell) : null });
  });
  return { people, sheets, startYear };
}

const monthDate = (startYear: number, index: number) => new Date(Date.UTC(startYear, 2 + index, 1));
const key = (d: Date) => d.toISOString().slice(0, 7);

// ───────────────────────── the config file ─────────────────────────

type MemberConfig = {
  sn: number;
  workbookName: string;
  title: string;
  fullName: string;
  phone: string;
  usualMonthly: number;
  bankName?: string;
  accountNumber?: string;
  occupation?: string;
  check?: string;
};
/** guarantorSn: the guarantor's S/N, or "verbal" for a guarantee agreed by word of mouth before the app. */
type LoanConfig = { sn: number; borrower: string; month: string; amount: number; guarantorSn: number | "verbal" | null; check?: string };
/** A contribution that pays ahead for several months (e.g. ₦60,000 = 4 × ₦15,000). */
type BatchConfig = { sn: number; month: string; months: number };
/** Contributions not written in the workbook (e.g. a member whose payments were kept elsewhere). */
type ExtraConfig = { sn: number; amount: number; months: string[]; note?: string };
/** One workbook row paying for two members (e.g. ₦20,000 = ₦10,000 each): `amount` of it belongs to shareSn. */
type SplitConfig = { sn: number; shareSn: number; amount: number; note?: string };
type Config = { workbook: string; openingBank: number; importThrough: string; members: MemberConfig[]; loans: LoanConfig[]; batches?: BatchConfig[]; extraContributions?: ExtraConfig[]; splitContributions?: SplitConfig[] };

function mostCommon(values: number[]) {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
}

function draftConfig(file: string, wbData: Awaited<ReturnType<typeof readWorkbook>>): Config {
  const { people, sheets, startYear } = wbData;
  const today = new Date();
  const thisMonth = key(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)));
  const members: MemberConfig[] = people.map((p) => {
    const paid = sheets.flatMap((s) => s.rows.filter((r) => r.sn === p.sn && r.c > 0).map((r) => r.c));
    const common = paid.length ? mostCommon(paid) : null;
    const { title, fullName } = splitName(p.name);
    const phone = normalizePhone(p.phone) ?? "";
    const checks = [
      !phone ? "PHONE MISSING: needed for the member's login" : "",
      !common ? "no payments found: enter the usual monthly amount" : common[1] < 2 ? `usual monthly is a guess (payments: ${[...new Set(paid)].join(", ")})` : "",
      sheets.some((s) => s.rows.some((r) => r.sn === p.sn && r.name !== p.name)) ? `name differs on the month sheets: "${sheets.flatMap((s) => s.rows).find((r) => r.sn === p.sn && r.name !== p.name)?.name}"` : "",
    ].filter(Boolean);
    return { sn: p.sn, workbookName: p.name, title, fullName, phone, usualMonthly: common?.[0] ?? 0, bankName: p.bank || undefined, accountNumber: p.account || undefined, occupation: p.occupation || undefined, ...(checks.length ? { check: checks.join("; ") } : {}) };
  });
  const loans: LoanConfig[] = [];
  for (const s of sheets) {
    for (const r of s.rows) {
      if (r.d > 0) loans.push({ sn: r.sn, borrower: r.name, month: key(monthDate(startYear, s.index)), amount: r.d, guarantorSn: null, check: 'GUARANTOR: the guarantor\'s S/N from Mem_Records, or "verbal"' });
    }
  }
  return { workbook: path.basename(file), openingBank: 0, importThrough: thisMonth, members, loans, batches: [] };
}

// ───────────────────────── the import itself ─────────────────────────

class DryRun extends Error {}

async function run(file: string, cfg: Config, commit: boolean) {
  const wbData = await readWorkbook(file);
  const { sheets, startYear } = wbData;
  const problems: string[] = [];
  const throughIndex = MONTHS.findIndex((_, i) => key(monthDate(startYear, i)) === cfg.importThrough);
  if (throughIndex < 0) throw new Error(`importThrough "${cfg.importThrough}" is not a month of this year.`);
  const used = sheets.filter((s) => s.index <= throughIndex);
  for (const x of cfg.extraContributions ?? []) {
    if (!cfg.members.some((m) => m.sn === x.sn)) problems.push(`Extra contributions: S/N ${x.sn} is not in the members list.`);
  }
  const lastClosed = throughIndex - 1; // the current month stays open for new payments

  const notes: string[] = [];
  for (const x of cfg.splitContributions ?? []) notes.push(`S/N ${x.sn}'s contribution is split: ${fmt(N(x.amount))} of it each month goes to S/N ${x.shareSn}.`);
  for (const x of cfg.extraContributions ?? []) notes.push(`S/N ${x.sn}: ${x.months.length} × ${fmt(N(x.amount))} added that are not in the workbook (${fmt(N(x.amount * x.months.length))}).`);
  for (const m of cfg.members) {
    if (m.phone && !normalizePhone(m.phone)) problems.push(`S/N ${m.sn} ${m.fullName}: "${m.phone}" is not a Nigerian phone number.`);
    if (!m.phone) notes.push(`S/N ${m.sn} ${m.fullName}: no phone in the file. If already in the app they keep their own; otherwise no login until it is added (Members → Edit details).`);
    if (!(m.usualMonthly > 0)) problems.push(`S/N ${m.sn} ${m.fullName}: usual monthly contribution missing.`);
  }
  for (const l of cfg.loans) {
    if (l.guarantorSn === "verbal") continue;
    if (!cfg.members.some((m) => m.sn === l.guarantorSn)) problems.push(`Loan ${fmt(N(l.amount))} to S/N ${l.sn} in ${l.month}: guarantor not set (an S/N, or "verbal").`);
    else if (l.guarantorSn === l.sn) problems.push(`Loan to S/N ${l.sn} in ${l.month}: a member cannot guarantee their own loan.`);
  }
  for (const b of cfg.batches ?? []) {
    const s = sheets.find((x) => key(monthDate(startYear, x.index)) === b.month);
    if (!s?.rows.some((r) => r.sn === b.sn && r.c > 0)) problems.push(`Batch for S/N ${b.sn} in ${b.month}: there is no contribution that month.`);
    if (!(b.months >= 2 && b.months <= 12)) problems.push(`Batch for S/N ${b.sn} in ${b.month}: months must be 2–12.`);
  }
  const phones = cfg.members.map((m) => normalizePhone(m.phone)).filter(Boolean);
  for (const p of new Set(phones)) if (phones.filter((x) => x === p).length > 1) problems.push(`Phone ${p} is used by two members.`);

  const year = await db.financialYear.findFirst({ where: { startDate: new Date(Date.UTC(startYear, 2, 1)) }, include: { periods: { orderBy: { month: "asc" } } } });
  if (!year) throw new Error(`The ${startYear}–${startYear + 1} year does not exist in the app (run the seed).`);
  const admin = await db.user.findFirst({ where: { roles: { some: { role: "ADMIN" } } } });
  if (!admin) throw new Error("No Admin account.");

  const report: string[] = [];
  const logins: string[] = ["Member no.,Name,Phone,Temporary password"];

  try {
    await db.$transaction(
      async (tx) => {
        // 1. Clear trial data; keep logins, members and the year's months.
        await tx.legalReferral.deleteMany();
        await tx.contactLog.deleteMany();
        await tx.notification.deleteMany();
        await tx.settlement.deleteMany();
        await tx.exit.deleteMany();
        await tx.loanMonth.deleteMany();
        await tx.loanApproval.deleteMany();
        await tx.ledgerEntry.updateMany({ data: { reversesId: null } });
        await tx.ledgerEntry.deleteMany();
        await tx.loan.deleteMany();
        await tx.receipt.deleteMany();
        await tx.investment.deleteMany();
        await tx.setting.deleteMany({ where: { key: OPENING_BANK_KEY } });
        await tx.period.updateMany({
          where: { yearId: year.id },
          data: { status: "OPEN", bankStatementKobo: null, readyById: null, presidentSignedById: null, presidentSignedAt: null, secretarySignedById: null, secretarySignedAt: null, lockedAt: null },
        });
        await tx.financialYear.update({ where: { id: year.id }, data: { status: "OPEN", dividendRateBps: null, closedAt: null, closedById: null } });

        // 2. Members: match an existing member by phone (or exact name), otherwise create with a login.
        const idBySn = new Map<number, string>();
        for (const m of cfg.members) {
          const phone = normalizePhone(m.phone);
          const data = { title: m.title || null, fullName: m.fullName, usualMonthlyKobo: N(m.usualMonthly || 0), bankName: m.bankName ?? null, accountNumber: m.accountNumber ?? null, occupation: m.occupation ?? null };
          const existing = (phone ? await tx.member.findUnique({ where: { phone } }) : null) ?? (await tx.member.findFirst({ where: { fullName: { equals: m.fullName, mode: "insensitive" } } }));
          if (existing) {
            await tx.member.update({ where: { id: existing.id }, data: { ...data, status: "ACTIVE" } });
            idBySn.set(m.sn, existing.id);
            report.push(`  ${existing.memberNo} ${m.fullName}: already in the app, details updated`);
            continue;
          }
          if (!phone) {
            const numbers = await tx.member.findMany({ select: { memberNo: true } });
            const created = await tx.member.create({ data: { ...data, memberNo: nextMemberNo(numbers.map((n) => n.memberNo)), phone: null, joinedAt: new Date(Date.UTC(startYear, 2, 1)) } });
            idBySn.set(m.sn, created.id);
            report.push(`  ${created.memberNo} ${m.fullName}: created (no phone yet, no login)`);
            continue;
          }
          const temp = `ipu-${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, "0")}-${"abcdefghjkmnpqrstuvwxyz"[randomBytes(1)[0] % 23]}${"abcdefghjkmnpqrstuvwxyz"[randomBytes(1)[0] % 23]}`;
          const taken = await tx.user.findUnique({ where: { phone } });
          const user = taken ?? (await tx.user.create({ data: { phone, passwordHash: await hash(temp), mustChangePassword: true, roles: { create: [{ role: "MEMBER" }] } } }));
          const numbers = await tx.member.findMany({ select: { memberNo: true } });
          const memberNo = nextMemberNo(numbers.map((n) => n.memberNo));
          const created = await tx.member.create({ data: { ...data, memberNo, phone, userId: user.id, joinedAt: new Date(Date.UTC(startYear, 2, 1)) } });
          idBySn.set(m.sn, created.id);
          if (!taken) logins.push(`${memberNo},"${m.title ? `${m.title} ` : ""}${m.fullName}",${phone},${temp}`);
          report.push(`  ${memberNo} ${m.fullName}: created${taken ? " (linked to the existing login)" : " with a login"}`);
        }

        // 3. Opening balance on 1 March.
        await tx.setting.create({ data: { key: OPENING_BANK_KEY, value: N(cfg.openingBank).toString(), effectiveFrom: year.startDate, createdById: admin.id } });

        // 4. Month by month: payments, loans, then close the month (interest worked out by the app).
        const loanIds = new Map<string, string>();
        const compare: string[] = [];
        for (const s of used) {
          const month = monthDate(startYear, s.index);
          const period = year.periods.find((p) => p.month.getTime() === month.getTime());
          if (!period) throw new Error(`Month ${key(month)} missing in the app.`);
          // Each month's figures are dated the 1st; the workbook does not record days.
          const date = month;
          const put = (memberId: string, type: "CONTRIBUTION" | "LOAN_GIVEN" | "INTEREST_PAID" | "LOAN_REPAID", naira: number, loanId?: string, coversMonths?: number) =>
            naira > 0 ? tx.ledgerEntry.create({ data: { date, periodId: period.id, memberId, type, amountKobo: N(naira), loanId, coversMonths: coversMonths ?? null, note: `Imported from ${cfg.workbook} (${s.month})`, enteredById: admin.id } }) : null;

          for (const r of s.rows) {
            const memberId = idBySn.get(r.sn);
            if (!memberId) {
              if (r.c || r.d || r.g || r.i) problems.push(`${s.month}: row S/N ${r.sn} "${r.name}" has money but is not in Mem_Records.`);
              continue;
            }
            const batch = cfg.batches?.find((b) => b.sn === r.sn && b.month === key(month));
            const split = cfg.splitContributions?.find((x) => x.sn === r.sn);
            const shareId = split ? idBySn.get(split.shareSn) : undefined;
            const share = split && shareId ? Math.min(split.amount, r.c) : 0;
            if (share > 0 && shareId) {
              await tx.ledgerEntry.create({
                data: { date, periodId: period.id, memberId: shareId, type: "CONTRIBUTION", amountKobo: N(share), note: split!.note ?? `Paid together with S/N ${r.sn} (${cfg.workbook}, ${s.month})`, enteredById: admin.id },
              });
            }
            await put(memberId, "CONTRIBUTION", r.c - share, undefined, batch?.months);
            if (r.d > 0) {
              const lc = cfg.loans.find((l) => l.sn === r.sn && l.month === key(month));
              const guarantorId = typeof lc?.guarantorSn === "number" ? idBySn.get(lc.guarantorSn) : undefined;
              const m = cfg.members.find((x) => x.sn === r.sn)!;
              const limit = loanLimit(N(m.usualMonthly || 0));
              const loan = await tx.loan.create({
                data: {
                  borrowerId: memberId,
                  guarantorId: guarantorId ?? null, // null = verbal guarantee before the app
                  amountKobo: N(r.d),
                  purpose: guarantorId ? `Imported from ${cfg.workbook}` : `Imported from ${cfg.workbook}; verbal guarantee (before the app)`,
                  status: "DISBURSED",
                  isException: N(r.d) > limit,
                  exceptionReason: N(r.d) > limit ? `Imported: above the limit of ${fmt(limit)} (usual monthly × 12)` : null,
                  disbursedOn: date,
                  requestedById: admin.id,
                },
              });
              loanIds.set(`${r.sn}`, loan.id);
              await put(memberId, "LOAN_GIVEN", r.d, loan.id);
            }
            const loanId = loanIds.get(`${r.sn}`);
            await put(memberId, "INTEREST_PAID", r.g, loanId);
            await put(memberId, "LOAN_REPAID", r.i, loanId);
          }

          for (const x of cfg.extraContributions ?? []) {
            const memberId = idBySn.get(x.sn);
            if (memberId && x.months.includes(key(month))) {
              await tx.ledgerEntry.create({
                data: { date, periodId: period.id, memberId, type: "CONTRIBUTION", amountKobo: N(x.amount), note: x.note ?? "Added at import (not in the workbook)", enteredById: admin.id },
              });
            }
          }

          // Workbook totals row must match what was read.
          const sum = (f: "c" | "d" | "g" | "i") => s.rows.reduce((t, r) => t + r[f], 0);
          for (const f of ["c", "d", "g", "i"] as const) {
            if (Math.abs(sum(f) - s.totals[f]) > 0.5) problems.push(`${s.month}: column ${f.toUpperCase()} adds up to ${sum(f)} but the sheet's total says ${s.totals[f]}.`);
          }

          if (s.index <= lastClosed) {
            const charged = await chargeInterest(period, admin.id, tx);
            const expected = await expectedBank(period, N(cfg.openingBank), tx);
            await tx.period.update({ where: { id: period.id }, data: { status: "LOCKED", bankStatementKobo: expected, readyById: admin.id, lockedAt: new Date() } });
            if (s.bank !== null && N(s.bank) !== expected) compare.push(`  ${s.month}: bank by the app ${fmt(expected)}, workbook "Total Money in Bank" ${fmt(N(s.bank))}`);
            for (const r of s.rows) {
              const memberId = idBySn.get(r.sn);
              const c = charged.find((x) => x.memberId === memberId);
              const appNext = c?.nextOwed ?? 0n;
              const appBal = c?.closing ?? 0n;
              if (appNext !== N(r.k) || appBal !== N(r.j)) {
                compare.push(`  ${s.month} · ${r.name}: loan balance app ${fmt(appBal)} / workbook ${fmt(N(r.j))}; interest due next month app ${fmt(appNext)} / workbook ${fmt(N(r.k))}`);
              }
            }
          }
        }
        report.push("", "Differences from the workbook (closed months):", ...(compare.length ? compare : ["  none"]));

        // 5. Where everyone stands now.
        const positions = await tx.ledgerEntry.groupBy({ by: ["memberId", "type"], where: { memberId: { not: null } }, _sum: { amountKobo: true } });
        report.push("", "Now (app):");
        for (const m of cfg.members) {
          const id = idBySn.get(m.sn);
          const rows = positions.filter((p) => p.memberId === id);
          const s = (t: string) => rows.find((r) => r.type === t)?._sum.amountKobo ?? 0n;
          const principal = s("LOAN_GIVEN") - s("LOAN_REPAID");
          const owed = s("INTEREST_CHARGED") - s("INTEREST_PAID");
          report.push(`  ${String(m.sn).padStart(2)} ${m.fullName.padEnd(30)} savings ${fmt(s("CONTRIBUTION")).padStart(11)}   loan ${fmt(principal).padStart(9)}   interest ${owed < 0n ? `credit ${fmt(-owed)}` : fmt(owed)}`);
        }
        const last = year.periods.find((p) => p.month.getTime() === monthDate(startYear, throughIndex).getTime())!;
        report.push("", `Bank by the app at the end of ${MONTHS[throughIndex]} so far: ${fmt(await expectedBank(last, N(cfg.openingBank), tx))}`);

        if (!commit || problems.length) throw new DryRun();
      },
      { timeout: 600_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }

  console.log(`\n${commit && !problems.length ? "IMPORTED" : "DRY RUN (nothing saved)"}: ${cfg.workbook}, ${used.length} months up to ${MONTHS[throughIndex]}; ${MONTHS[lastClosed]} and earlier closed\n`);
  console.log(["Members:", ...report].join("\n"));
  if (notes.length) console.log(`\nNotes:\n${notes.map((p) => `  • ${p}`).join("\n")}`);
  if (problems.length) console.log(`\nTo fix before --commit:\n${problems.map((p) => `  • ${p}`).join("\n")}`);
  if (commit && !problems.length && logins.length > 1) {
    const out = path.join("import", `logins-${Date.now()}.csv`);
    writeFileSync(out, logins.join("\n") + "\n");
    console.log(`\nTemporary passwords for the new members: ${out}  (private: give each member theirs, then delete the file)`);
  }
}

async function main() {
  // Windows PowerShell can swallow "--commit"; also accept plain "commit", or the import:commit script.
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--") && a !== "commit");
  const commit = args.includes("--commit") || args.includes("commit") || process.env.IMPORT_COMMIT === "1";
  if (!file || !existsSync(file)) {
    console.log('Usage: npm run import:workbook -- "<workbook.xlsx>"   (dry run)\n       npm run import:commit -- "<workbook.xlsx>"     (save)');
    process.exit(1);
  }
  mkdirSync("import", { recursive: true });
  const cfgPath = path.join("import", `${path.basename(file).replace(/\.xlsx$/i, "")}.json`);
  if (!existsSync(cfgPath)) {
    const draft = draftConfig(file, await readWorkbook(file));
    writeFileSync(cfgPath, JSON.stringify(draft, null, 2) + "\n");
    console.log(`Wrote ${cfgPath}. Fill in what is marked "check" (phones, usual monthly, guarantors), then run again.`);
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Config;
  await run(file, cfg, commit);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await db.$disconnect();
  process.exit(1);
});
