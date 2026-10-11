/**
 * Nigerian phone numbers are stored in one form: +234 followed by 10 digits.
 * Accepts what members type: "0803 445 3367", "08034453367", "2348034453367", "+234 803 445 3367".
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string | null = null;
  if (/^\+234\d{10}$/.test(digits)) national = digits.slice(4);
  else if (/^234\d{10}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{10}$/.test(digits)) national = digits.slice(1);
  if (!national || !/^[789]\d{9}$/.test(national)) return null;
  return `+234${national}`;
}

/** +2349076729480 → 0907 672 9480 (how members write it). */
export function displayPhone(stored: string | null): string {
  if (!stored) return "No phone yet";
  const n = stored.replace(/^\+234/, "0");
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}
