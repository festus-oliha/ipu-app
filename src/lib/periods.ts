import "server-only";
import { db } from "./db";

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-11" → first day of that month (UTC). */
export function monthStart(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return new Date(Date.UTC(Number(m[1]), month - 1, 1));
}

export const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
export const monthLabel = (d: Date) => `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** "2026-11-05" (from a date input) → Date at UTC midnight, or null. */
export function parseDateInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today's date in Lagos as yyyy-mm-dd. */
export function todayLagos(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
}

export function formatDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

/** The month (period) a payment dated `date` belongs to, if it exists. */
export async function periodFor(date: Date) {
  const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return db.period.findFirst({ where: { month }, include: { year: true } });
}

/** The open financial year (the one most recently started). */
export async function currentYear() {
  return db.financialYear.findFirst({ where: { status: { not: "CLOSED" } }, orderBy: { startDate: "desc" } });
}
