"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseNaira } from "@/lib/money";
import { parseDateInput, periodFor, todayLagos } from "@/lib/periods";
import { FILE_TYPES, putFile, readUpload } from "@/lib/storage";

export type UploadState = { errors?: Record<string, string>; values?: Record<string, string>; error?: string };

const PARTS = ["contribution", "interest", "repayment", "membershipFee"] as const;

/** A member uploads a photo or PDF of a bank receipt; an officer checks it before it counts. */
export async function uploadReceipt(_prev: UploadState, form: FormData): Promise<UploadState> {
  const user = await requireUser();
  const member = user.member;
  if (!member) return { error: "Your login is not linked to a member record. Ask the Secretary." };
  const record = await db.member.findUnique({ where: { id: member.id } });
  if (record?.status === "EXITED") return { error: "You have left the union, so receipts can no longer be uploaded." };

  const values = Object.fromEntries(["date", ...PARTS].map((k) => [k, String(form.get(k) ?? "")]));
  const errors: Record<string, string> = {};
  const kobo: Record<string, bigint> = {};
  for (const k of PARTS) {
    kobo[k] = 0n;
    if (!values[k].trim()) continue;
    try {
      kobo[k] = parseNaira(values[k]);
      if (kobo[k] < 0n) errors[k] = "The amount cannot be negative.";
    } catch {
      errors[k] = "Enter an amount in naira, e.g. 10,000.";
    }
  }
  const total = PARTS.reduce((t, k) => t + kobo[k], 0n);
  if (!Object.keys(errors).length && total === 0n) errors.contribution = "Enter what the money is for (at least one amount).";

  const date = parseDateInput(values.date);
  if (!date) errors.date = "Enter the date on the receipt.";
  else if (values.date > todayLagos()) errors.date = "The date cannot be in the future.";
  else if (!(await periodFor(date))) errors.date = "That date is outside the open financial year.";

  const file = await readUpload(form.get("file"));
  if ("error" in file) errors.file = file.error;
  if (Object.keys(errors).length || "error" in file || !date) return { errors, values };

  const id = randomUUID();
  const fileKey = `receipts/${member.id}/${id}.${FILE_TYPES[file.type]}`;
  try {
    await putFile(fileKey, file.bytes, file.type);
  } catch (e) {
    // Show the reason instead of a blank error page; it is also in the Netlify function log.
    console.error("[receipt upload]", e);
    return { values, error: `The receipt could not be saved: ${(e as Error).message}. Please try again later, or tell the Admin.` };
  }
  const receipt = await db.receipt.create({
    data: {
      id,
      memberId: member.id,
      amountKobo: total,
      paidOn: date,
      fileKey,
      contributionKobo: kobo.contribution,
      interestKobo: kobo.interest,
      repaymentKobo: kobo.repayment,
      otherKobo: kobo.membershipFee,
      uploadedById: user.id,
    },
  });
  await audit({ userId: user.id, action: "receipt.upload", table: "Receipt", recordId: receipt.id, newValue: receipt });
  revalidatePath("/", "layout");
  redirect("/?uploaded=1");
}
