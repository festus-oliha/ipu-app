import "server-only";
import { cache } from "react";
import { db } from "./db";
import { DEFAULT_RULES, type Rules, monthRange } from "./rules";
import { todayLagos } from "./periods";

/**
 * Union rules the Admin can change on the Settings page. Each change is a new
 * row in Setting with the date it takes effect, so past months keep the rule
 * that applied to them (e.g. interest charged in July stays at July's rate).
 */
export type SettingDef = {
  key: string;
  label: string;
  hint: string;
  default: number | string;
  min?: number;
  max?: number;
  kind: "number" | "month" | "phone";
  /** Takes effect from the 1st of a chosen month (money rules) or at once. */
  fromMonth: boolean;
};

export const SETTING_DEFS: SettingDef[] = [
  { key: "INTEREST_PER_1000", label: "Interest per ₦1,000 a month (₦)", hint: "25 means ₦25 on every ₦1,000 still owed (2.5% a month).", default: 25, min: 1, max: 200, kind: "number", fromMonth: true },
  { key: "LOAN_LIMIT_MONTHS", label: "Loan limit (× usual monthly contribution)", hint: "12 means a member paying ₦10,000 a month may borrow up to ₦120,000 without an exception.", default: 12, min: 1, max: 60, kind: "number", fromMonth: true },
  { key: "LOAN_FIRST_MONTH", label: "First month loans are paid out", hint: "Loans are paid out from this month…", default: 3, kind: "month", fromMonth: true },
  { key: "LOAN_LAST_MONTH", label: "Last month loans are paid out", hint: "…to this month, so they can be repaid before the year closes.", default: 12, kind: "month", fromMonth: true },
  { key: "MAX_GUARANTEES", label: "Loans one person may guarantee", hint: "At the same time.", default: 2, min: 1, max: 10, kind: "number", fromMonth: true },
  { key: "DIVIDEND_MIN_MONTHS", label: "Months of contributions to share in the dividend", hint: "Members with fewer months get no dividend.", default: 4, min: 1, max: 12, kind: "number", fromMonth: true },
  { key: "DEFAULT_AFTER_MONTHS", label: "Months of unpaid interest before a default", hint: "A loan can be declared in default only after this many months in a row.", default: 2, min: 1, max: 12, kind: "number", fromMonth: true },
  { key: "NOTICE_DAYS", label: "Days of notice before savings are used", hint: "After a default, the borrower and guarantor get this many days.", default: 7, min: 1, max: 60, kind: "number", fromMonth: true },
  { key: "CONTRIBUTION_NOTICE_AFTER", label: "Months without contribution before a notice (on loan)", hint: "The notice goes out in the following month.", default: 2, min: 1, max: 6, kind: "number", fromMonth: true },
  { key: "ADMIN_PHONE", label: "Phone for password help", hint: "Shown on the sign-in page: members call or message this number when they forget their password.", default: "+2349076729480", kind: "phone", fromMonth: false },
];

export type UnionSettings = Rules & {
  defaultAfterMonths: number;
  noticeDays: number;
  contributionNoticeAfter: number;
  adminPhone: string;
  values: Record<string, string>;
};

/** The settings in force on a date (a Date, or "YYYY-MM-DD"). */
async function load(dateIso: string): Promise<UnionSettings> {
  const rows = await db.setting.findMany({
    where: { key: { in: SETTING_DEFS.map((d) => d.key) }, effectiveFrom: { lte: new Date(`${dateIso}T00:00:00Z`) } },
    orderBy: { effectiveFrom: "asc" },
  });
  const values: Record<string, string> = Object.fromEntries(SETTING_DEFS.map((d) => [d.key, String(d.default)]));
  for (const r of rows) values[r.key] = r.value; // the latest one wins
  const n = (k: string) => Number(values[k]);
  return {
    ...DEFAULT_RULES,
    interestPer1000: BigInt(n("INTEREST_PER_1000")),
    loanLimitMonths: BigInt(n("LOAN_LIMIT_MONTHS")),
    loanMonths: monthRange(n("LOAN_FIRST_MONTH"), n("LOAN_LAST_MONTH")),
    maxGuarantees: n("MAX_GUARANTEES"),
    dividendMinMonths: n("DIVIDEND_MIN_MONTHS"),
    defaultAfterMonths: n("DEFAULT_AFTER_MONTHS"),
    noticeDays: n("NOTICE_DAYS"),
    contributionNoticeAfter: n("CONTRIBUTION_NOTICE_AFTER"),
    adminPhone: values.ADMIN_PHONE,
    values,
  };
}

const loadCached = cache(load);

/** Settings in force on `date` (default: today in Lagos). Cached for the request. */
export function settingsAt(date?: Date | string) {
  const iso = date === undefined ? todayLagos() : typeof date === "string" ? date : date.toISOString().slice(0, 10);
  return loadCached(iso);
}

/** The earliest month a rule change may start: the first month not yet closed. */
export async function firstChangeableMonth() {
  const locked = await db.period.findFirst({ where: { status: { not: "OPEN" } }, orderBy: { month: "desc" } });
  const thisMonth = new Date(`${todayLagos().slice(0, 7)}-01T00:00:00Z`);
  const afterLocked = locked ? new Date(Date.UTC(locked.month.getUTCFullYear(), locked.month.getUTCMonth() + 1, 1)) : thisMonth;
  return afterLocked > thisMonth ? afterLocked : thisMonth;
}

