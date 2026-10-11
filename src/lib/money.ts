/**
 * Money helpers. All amounts inside the app are KOBO held as bigint
 * (₦1 = 100 kobo). Convert only at the edges: when reading a form and when
 * showing a figure on screen or in a PDF.
 */

export type Kobo = bigint;

export const KOBO_PER_NAIRA = 100n;

/** "10,000", "₦10,000.50", "10000.5" → 1000050n. Throws on anything else. */
export function parseNaira(input: string): Kobo {
  const cleaned = input.replace(/[₦,\s]/g, "").replace(/^N/i, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Not a valid naira amount: "${input}"`);
  }
  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
  const kobo = BigInt(whole) * KOBO_PER_NAIRA + BigInt(fraction.padEnd(2, "0"));
  return negative ? -kobo : kobo;
}

/** 1000050n → "₦10,000.50" (or "₦10,000" when whole and `compact` is set). */
export function formatNaira(kobo: Kobo, opts: { compact?: boolean } = {}): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const whole = abs / KOBO_PER_NAIRA;
  const fraction = abs % KOBO_PER_NAIRA;
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text =
    opts.compact && fraction === 0n
      ? `₦${wholeText}`
      : `₦${wholeText}.${fraction.toString().padStart(2, "0")}`;
  return negative ? `-${text}` : text;
}

/** Naira for SMS (plain "N", no symbol, no kobo when whole): 1000000n → "N10,000". */
export function formatNairaSms(kobo: Kobo): string {
  return formatNaira(kobo, { compact: true }).replace("₦", "N");
}

/** Multiply by a fraction and round half-up to the nearest kobo. */
export function mulDivRound(amount: Kobo, numerator: bigint, denominator: bigint): Kobo {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  const product = amount * numerator;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

export const sum = (values: Kobo[]): Kobo => values.reduce((a, b) => a + b, 0n);
