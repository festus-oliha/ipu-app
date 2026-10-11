"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { actionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import type { FormResult } from "@/components/ActionForm";
import { flushOutbox, queueSms } from "@/lib/notify";
import { normalizePhone } from "@/lib/phone";

export async function sendNow(): Promise<FormResult> {
  await actionUser("ADMIN", "TREASURER");
  const r = await flushOutbox(300);
  revalidatePath("/office/messages");
  return { done: `Sent ${r.sent}, failed ${r.failed}, still waiting ${r.waiting}.` };
}

/** Failed messages get three fresh tries. */
export async function retryFailed(): Promise<FormResult> {
  const user = await actionUser("ADMIN", "TREASURER");
  const r = await db.notification.updateMany({ where: { status: "FAILED" }, data: { status: "QUEUED", attempts: 0 } });
  await audit({ userId: user.id, action: "messages.retry", table: "Notification", recordId: "*", newValue: { count: r.count } });
  const sent = await flushOutbox(300);
  revalidatePath("/office/messages");
  return { done: `${r.count} message(s) tried again: ${sent.sent} sent, ${sent.failed} failed.` };
}

/** Sends one SMS to a phone number to check the provider works. */
export async function testSms(_prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser("ADMIN");
  const to = normalizePhone(String(form.get("phone") ?? ""));
  if (!to) return { errors: { phone: "Enter a Nigerian phone number." } };
  await queueSms(to, "test", "IPU: This is a test message from the union app.");
  await audit({ userId: user.id, action: "messages.test", table: "Notification", recordId: to });
  const r = await flushOutbox(5);
  revalidatePath("/office/messages");
  return { done: r.sent ? "Test SMS sent." : "Test SMS queued. See the list below for the result." };
}

/** Runs today's due jobs now (they also run every hour on the live site). */
export async function runJobsNow(): Promise<FormResult> {
  const user = await actionUser("ADMIN");
  const { recordManualRun, runJobs } = await import("@/lib/jobs");
  const r = await runJobs();
  await recordManualRun(user.id, r);
  revalidatePath("/office/messages");
  return { done: `${r.ran.length ? r.ran.join(" · ") : "Nothing due today (or already done)."} Messages sent: ${r.outbox.sent}.` };
}
