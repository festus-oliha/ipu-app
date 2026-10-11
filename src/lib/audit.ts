import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient;

/** Turns bigint (kobo) and dates into JSON-safe values for the change log. */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

/** Append one line to the change log. It is never updated or deleted. */
export async function audit(
  entry: {
    userId: string | null;
    action: string;
    table: string;
    recordId: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
  },
  tx: Tx | typeof db = db,
) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId,
      action: entry.action,
      table: entry.table,
      recordId: entry.recordId,
      oldValue: toJson(entry.oldValue),
      newValue: toJson(entry.newValue),
      reason: entry.reason,
    },
  });
}
