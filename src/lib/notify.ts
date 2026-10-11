import "server-only";
import { after } from "next/server";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { emailConfigured, sendEmail, sendSms, smsCostKobo, smsProvider } from "./messaging";

type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 3;

/**
 * Puts an SMS in the outbox. It is sent right after the page responds (and
 * again by the hourly job if that fails), so no payment ever goes without its message.
 */
export async function queueSms(to: string, template: string, message: string, tx: Tx | typeof db = db) {
  await tx.notification.create({ data: { to, channel: "SMS", template, message } });
  kick();
}

export async function queueEmail(to: string, template: string, subject: string, message: string, tx: Tx | typeof db = db) {
  await tx.notification.create({ data: { to, channel: "EMAIL", template, subject, message } });
  kick();
}

/** Ask for the outbox to be sent after the current response — once per request (React cache). */
const kickOnce = cache(() => {
  after(() => flushOutbox().then(() => undefined, (e) => console.error("[outbox]", e)));
});
function kick() {
  try {
    kickOnce();
  } catch {
    // outside a request (scripts, tests): the hourly job sends it
  }
}

/**
 * Sends waiting messages. Each message is claimed first (attempts + 1 where
 * attempts is unchanged), so two runs at once never send the same message twice.
 */
export async function flushOutbox(limit = 100, deadline = Date.now() + 20_000) {
  const waiting = await db.notification.findMany({
    where: { channel: { in: ["SMS", "EMAIL"] }, OR: [{ status: "QUEUED" }, { status: "FAILED", attempts: { lt: MAX_ATTEMPTS } }] },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < waiting.length && Date.now() < deadline; i += 5) {
    await Promise.all(
      waiting.slice(i, i + 5).map(async (n) => {
        // Not set up yet: leave it queued, untouched, until a provider is configured.
        const missing = n.channel === "SMS" ? (smsProvider() ? null : "No SMS provider set up yet.") : emailConfigured() ? null : "Email (SMTP) is not set up yet.";
        if (missing) {
          if (n.error !== missing) await db.notification.update({ where: { id: n.id }, data: { error: missing } });
          return;
        }
        // Claim before sending, so a second run at the same moment skips it.
        const claimed = await db.notification.updateMany({ where: { id: n.id, attempts: n.attempts, status: n.status }, data: { attempts: n.attempts + 1 } });
        if (claimed.count !== 1) return;
        const result = n.channel === "SMS" ? await sendSms(n.to, n.message) : await sendEmail(n.to, n.subject ?? "Iyobor Progressive Union", n.message);
        if (result.ok) {
          sent++;
          await db.notification.update({
            where: { id: n.id },
            data: { status: "SENT", sentAt: new Date(), providerRef: result.ref, error: null, costKobo: n.channel === "SMS" ? smsCostKobo(n.message) : null },
          });
        } else {
          failed++;
          await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", error: result.error, ...(result.retry ? {} : { attempts: MAX_ATTEMPTS }) } });
        }
      }),
    );
  }
  return { sent, failed, waiting: waiting.length - sent - failed };
}
