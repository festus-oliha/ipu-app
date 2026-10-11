import "server-only";

/**
 * Delivery of SMS and email. The app never waits on these: messages are
 * written to the outbox (Notification table) and sent from there, so a slow
 * provider never blocks an officer, and failures are retried.
 *
 * SMS:   SMS_PROVIDER=termii (TERMII_API_KEY, TERMII_SENDER_ID, optional
 *        TERMII_BASE_URL and TERMII_CHANNEL). Empty = messages wait in the
 *        outbox until a provider is set up. "log" = pretend-send (testing).
 * Email: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM. For Gmail use
 *        smtp.gmail.com, port 465, and an app password (not the normal one).
 */

export type SendResult = { ok: true; ref?: string } | { ok: false; error: string; retry: boolean };

/** One SMS page is 160 characters (153 when a message is split). */
export function smsPages(text: string) {
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/** Estimated cost in kobo, from SMS_UNIT_COST (naira per page, e.g. 5). */
export function smsCostKobo(text: string) {
  const unit = Number(process.env.SMS_UNIT_COST ?? "");
  return Number.isFinite(unit) && unit > 0 ? BigInt(Math.round(unit * 100)) * BigInt(smsPages(text)) : null;
}

export function smsProvider(): "termii" | "log" | null {
  const p = process.env.SMS_PROVIDER?.trim().toLowerCase();
  return p === "termii" || p === "log" ? p : null;
}

export function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendSms(to: string, text: string): Promise<SendResult> {
  const provider = smsProvider();
  if (!provider) return { ok: false, error: "No SMS provider set up yet.", retry: false };
  if (provider === "log") {
    console.log(`[sms] to ${to}: ${text}`);
    return { ok: true, ref: "log" };
  }
  const key = process.env.TERMII_API_KEY?.trim();
  const from = process.env.TERMII_SENDER_ID?.trim();
  if (!key || !from) return { ok: false, error: "TERMII_API_KEY or TERMII_SENDER_ID is empty.", retry: false };
  const base = (process.env.TERMII_BASE_URL?.trim() || "https://api.ng.termii.com").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/sms/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        to: to.replace(/^\+/, ""), // 2348031234567
        from,
        sms: text,
        type: "plain",
        // "dnd" reaches numbers on Do-Not-Disturb (most Nigerian lines); needs a registered sender ID.
        channel: process.env.TERMII_CHANNEL?.trim() || "dnd",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { message_id?: string; message?: string };
    if (res.ok && body.message_id) return { ok: true, ref: String(body.message_id) };
    return { ok: false, error: `Termii ${res.status}: ${body.message ?? "no message id"}`, retry: res.status >= 500 || res.status === 429 };
  } catch (e) {
    return { ok: false, error: `Termii unreachable: ${(e as Error).message}`, retry: true };
  }
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  attachments?: { filename: string; content: Buffer }[],
): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "Email (SMTP) is not set up yet.", retry: false };
  const { createTransport } = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  try {
    const info = await transport.sendMail({
      from: process.env.EMAIL_FROM || `Iyobor Progressive Union <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      attachments,
    });
    return { ok: true, ref: info.messageId };
  } catch (e) {
    return { ok: false, error: `Email failed: ${(e as Error).message}`, retry: true };
  }
}
