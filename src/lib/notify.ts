import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient;

/**
 * Puts an SMS in the outbox. A later phase adds the sender that delivers queued
 * messages through the chosen provider; until then they wait here, so no
 * payment ever goes without its message.
 */
export async function queueSms(to: string, template: string, message: string, tx: Tx | typeof db = db) {
  await tx.notification.create({ data: { to, channel: "SMS", template, message } });
}
