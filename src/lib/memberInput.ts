import { z } from "zod";
import { parseNaira } from "./money";
import { normalizePhone } from "./phone";

export const TITLES = ["", "Mrs", "Mr", "Miss", "Madam", "Chief", "Dr", "Pastor"] as const;

const optional = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v));

/** Validates the member form. Returns field errors in plain words. */
export function parseMemberForm(form: FormData) {
  const raw = Object.fromEntries(
    [
      "title", "fullName", "phone", "email", "occupation", "address", "bankName", "accountNumber",
      "yearJoined", "usualMonthly", "emergencyName", "emergencyPhone", "status",
    ].map((k) => [k, String(form.get(k) ?? "")]),
  );

  const errors: Record<string, string> = {};
  const fullName = raw.fullName.trim();
  if (fullName.length < 3) errors.fullName = "Enter the member's full name.";

  // A member can be added before their phone number is known; they get a login once it is entered.
  const phone = raw.phone.trim() ? normalizePhone(raw.phone) : null;
  if (raw.phone.trim() && !phone) errors.phone = "Enter a Nigerian phone number, e.g. 0803 445 3367, or leave it empty for now.";

  const emergencyPhoneRaw = raw.emergencyPhone.trim();
  const emergencyPhone = emergencyPhoneRaw ? normalizePhone(emergencyPhoneRaw) : null;
  if (emergencyPhoneRaw && !emergencyPhone) errors.emergencyPhone = "Enter a valid phone number or leave it empty.";

  const email = raw.email.trim();
  if (email && !z.email().safeParse(email).success) errors.email = "Enter a valid email or leave it empty.";

  const accountNumber = raw.accountNumber.replace(/\s/g, "");
  if (accountNumber && !/^\d{10}$/.test(accountNumber)) errors.accountNumber = "Nigerian account numbers have 10 digits.";

  let yearJoined: number | null = null;
  if (raw.yearJoined.trim()) {
    yearJoined = Number(raw.yearJoined);
    if (!Number.isInteger(yearJoined) || yearJoined < 1950 || yearJoined > new Date().getFullYear()) {
      errors.yearJoined = "Enter a year such as 2011.";
    }
  }

  let usualMonthlyKobo = 0n;
  try {
    usualMonthlyKobo = raw.usualMonthly.trim() ? parseNaira(raw.usualMonthly) : 0n;
    if (usualMonthlyKobo < 0n) errors.usualMonthly = "The amount cannot be negative.";
  } catch {
    errors.usualMonthly = "Enter an amount in naira, e.g. 10,000.";
  }

  const status = (["ACTIVE", "SUSPENDED", "EXITED"] as const).find((s) => s === raw.status) ?? "ACTIVE";
  const title = TITLES.includes(raw.title as (typeof TITLES)[number]) ? raw.title : "";

  return {
    errors,
    values: raw,
    data: {
      title: title || null,
      fullName,
      phone,
      email: optional.parse(email),
      occupation: optional.parse(raw.occupation),
      address: optional.parse(raw.address),
      bankName: optional.parse(raw.bankName),
      accountNumber: accountNumber || null,
      yearJoined,
      usualMonthlyKobo,
      emergencyName: optional.parse(raw.emergencyName),
      emergencyPhone,
      status,
    },
  };
}

/** Next free member number: IPU-0001, IPU-0002, … */
export function nextMemberNo(existing: string[]): string {
  const max = existing.reduce((m, no) => {
    const n = Number(/^IPU-(\d+)$/.exec(no)?.[1] ?? 0);
    return n > m ? n : m;
  }, 0);
  return `IPU-${String(max + 1).padStart(4, "0")}`;
}
