import "server-only";
import ExcelJS from "exceljs";
import { db } from "./db";
import { ENTRY_LABELS } from "./ledger";
import { positionsThrough } from "./loans";
import { monthLabel } from "./periods";
import { buildMonthSheet } from "./sheet";

const naira = (k: bigint | null | undefined) => (k === null || k === undefined ? null : Number(k) / 100);
const MONEY = '"₦"#,##0.00;[Red]-"₦"#,##0.00';
const FOREST = "FF1E4D3A";

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFBF8F1" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOREST } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function sheet(wb: ExcelJS.Workbook, name: string, columns: { header: string; key: string; width?: number; money?: boolean }[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16, style: c.money ? { numFmt: MONEY } : undefined }));
  styleHeader(ws);
  return ws;
}

/** The month sheets of one year, laid out like the old workbook (one tab per month). */
export async function buildYearWorkbook(yearId: string) {
  const year = await db.financialYear.findUniqueOrThrow({ where: { id: yearId }, include: { periods: { orderBy: { month: "asc" } } } });
  const wb = new ExcelJS.Workbook();
  wb.creator = "IPU app";
  for (const p of year.periods) {
    const { rows, totals } = await buildMonthSheet(p);
    const ws = sheet(wb, monthLabel(p.month).slice(0, 3), [
      { header: "No.", key: "no", width: 10 },
      { header: "Member", key: "name", width: 30 },
      { header: "Contribution", key: "contribution", money: true },
      { header: "Membership fee", key: "fee", money: true },
      { header: "Loan given", key: "given", money: true },
      { header: "Interest paid", key: "interest", money: true },
      { header: "Loan repaid", key: "repaid", money: true },
      { header: "Loan balance", key: "balance", money: true },
      { header: "Interest due", key: "due", money: true },
      { header: "Savings to date", key: "savings", money: true },
    ]);
    for (const r of rows) {
      ws.addRow({ no: r.memberNo, name: r.name, contribution: naira(r.contribution), fee: naira(r.membershipFee), given: naira(r.loanGiven), interest: naira(r.interestPaid), repaid: naira(r.loanRepaid), balance: naira(r.loanBalance), due: naira(r.interestOwed), savings: naira(r.savingsToDate) });
    }
    const t = ws.addRow({ name: `Total (${p.status.toLowerCase()})`, contribution: naira(totals.contribution), fee: naira(totals.membershipFee), given: naira(totals.loanGiven), interest: naira(totals.interestPaid), repaid: naira(totals.loanRepaid), balance: naira(totals.loanBalance), due: naira(totals.interestOwed), savings: naira(totals.savingsToDate) });
    t.font = { bold: true };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Everything, for the monthly backup: members, every ledger row, loans, settlements, investments. */
export async function buildBackupWorkbook() {
  const [members, entries, loans, settlements, investments, positions] = await Promise.all([
    db.member.findMany({ orderBy: { memberNo: "asc" } }),
    db.ledgerEntry.findMany({ include: { member: true, period: true, reversedBy: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] }),
    db.loan.findMany({ include: { borrower: true, guarantor: true }, orderBy: { createdAt: "asc" } }),
    db.settlement.findMany({ include: { member: true, year: true }, orderBy: [{ yearId: "asc" }] }),
    db.investment.findMany({ orderBy: { createdAt: "asc" } }),
    positionsThrough(new Date(Date.UTC(2100, 0, 1))),
  ]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "IPU app";

  const m = sheet(wb, "Members", [
    { header: "No.", key: "no", width: 10 }, { header: "Title", key: "title", width: 8 }, { header: "Name", key: "name", width: 28 },
    { header: "Phone", key: "phone" }, { header: "Email", key: "email", width: 24 }, { header: "Bank", key: "bank" }, { header: "Account", key: "acct" },
    { header: "Usual monthly", key: "usual", money: true }, { header: "Status", key: "status", width: 10 },
    { header: "Loan balance", key: "loan", money: true }, { header: "Interest owed", key: "owed", money: true },
  ]);
  for (const x of members) {
    const p = positions.get(x.id);
    m.addRow({ no: x.memberNo, title: x.title, name: x.fullName, phone: x.phone, email: x.email, bank: x.bankName, acct: x.accountNumber, usual: naira(x.usualMonthlyKobo), status: x.status, loan: naira(p?.principal ?? 0n), owed: naira(p?.interestOwed ?? 0n) });
  }

  const l = sheet(wb, "Ledger", [
    { header: "Date", key: "date", width: 12 }, { header: "Month", key: "month", width: 14 }, { header: "Member", key: "member", width: 28 },
    { header: "Type", key: "type", width: 24 }, { header: "Amount", key: "amount", money: true }, { header: "Bank ref", key: "ref" },
    { header: "Note", key: "note", width: 30 }, { header: "Reversed", key: "reversed", width: 10 },
  ]);
  for (const e of entries) {
    l.addRow({ date: e.date, month: monthLabel(e.period.month), member: e.member ? `${e.member.memberNo} ${e.member.fullName}` : "", type: ENTRY_LABELS[e.type], amount: naira(e.amountKobo), ref: e.bankRef, note: e.note, reversed: e.reversedBy ? "yes" : "" });
  }
  l.getColumn("date").numFmt = "dd/mm/yyyy";

  const lo = sheet(wb, "Loans", [
    { header: "Borrower", key: "b", width: 28 }, { header: "Guarantor", key: "g", width: 28 }, { header: "Amount", key: "amt", money: true },
    { header: "Purpose", key: "purpose", width: 26 }, { header: "Status", key: "status", width: 14 }, { header: "Exception", key: "ex", width: 10 }, { header: "Paid out", key: "out", width: 12 },
  ]);
  for (const x of loans) lo.addRow({ b: `${x.borrower.memberNo} ${x.borrower.fullName}`, g: x.guarantor ? `${x.guarantor.memberNo} ${x.guarantor.fullName}` : "Verbal (not recorded)", amt: naira(x.amountKobo), purpose: x.purpose, status: x.status, ex: x.isException ? "yes" : "", out: x.disbursedOn });

  const s = sheet(wb, "Settlements", [
    { header: "Year", key: "y", width: 12 }, { header: "Member", key: "m", width: 28 }, { header: "Savings", key: "c", money: true }, { header: "Months", key: "mo", width: 8 },
    { header: "Dividend", key: "d", money: true }, { header: "Credit back", key: "cr", money: true }, { header: "Interest taken", key: "i", money: true },
    { header: "Loan taken", key: "lt", money: true }, { header: "Payout (− owes)", key: "p", money: true }, { header: "Paid on", key: "paid", width: 12 },
  ]);
  for (const x of settlements) s.addRow({ y: x.year.label, m: `${x.member.memberNo} ${x.member.fullName}`, c: naira(x.contributionsKobo), mo: x.monthsContributed, d: naira(x.dividendKobo), cr: naira(x.creditRefundKobo), i: naira(x.interestDeductedKobo), lt: naira(x.loanDeductedKobo), p: naira(x.payoutKobo), paid: x.paidOn });

  const iv = sheet(wb, "Investments", [
    { header: "Kind", key: "k", width: 24 }, { header: "Institution", key: "i", width: 22 }, { header: "Placed", key: "a", money: true }, { header: "On", key: "on", width: 12 },
    { header: "Rate %", key: "r", width: 8 }, { header: "Matures", key: "mat", width: 12 }, { header: "Returned", key: "ret", money: true }, { header: "Status", key: "s", width: 12 },
  ]);
  for (const x of investments) iv.addRow({ k: x.kind, i: x.institution, a: naira(x.amountPlacedKobo), on: x.placedOn, r: x.rateBps ? x.rateBps / 100 : null, mat: x.maturityOn, ret: naira(x.amountReturnedKobo), s: x.status });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
