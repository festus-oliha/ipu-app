"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormResult } from "@/components/ActionForm";
import { audit } from "@/lib/audit";
import { MIN_PASSWORD_LENGTH, actionUser, hashPassword, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

const text = (form: FormData, key: string, max = 200) => {
  const v = String(form.get(key) ?? "").trim().slice(0, max);
  return v === "" ? null : v;
};

/**
 * A member updates their own contact details. Phone (their login) and bank
 * details (where payouts go) stay with the Secretary, so a stolen password
 * cannot redirect money.
 */
export type DetailsResult = FormResult & { values?: Record<string, string> };

export async function updateMyDetails(_prev: DetailsResult, form: FormData): Promise<DetailsResult> {
  const user = await actionUser();
  if (!user.member) return { error: "Your account is not linked to a member record. Ask the Admin." };
  const before = await db.member.findUniqueOrThrow({ where: { id: user.member.id } });

  const errors: Record<string, string> = {};
  const email = text(form, "email");
  if (email && !z.email().safeParse(email).success) errors.email = "Enter a valid email or leave it empty.";
  const emergencyRaw = text(form, "emergencyPhone", 30);
  const emergencyPhone = emergencyRaw ? normalizePhone(emergencyRaw) : null;
  if (emergencyRaw && !emergencyPhone) errors.emergencyPhone = "Enter a valid phone number or leave it empty.";
  // Send back what was typed, so a mistake in one box does not clear the others.
  if (Object.keys(errors).length) {
    const values = Object.fromEntries(["email", "occupation", "address", "emergencyName", "emergencyPhone"].map((k) => [k, String(form.get(k) ?? "")]));
    return { errors, values };
  }

  const data = {
    email,
    occupation: text(form, "occupation"),
    address: text(form, "address", 300),
    emergencyName: text(form, "emergencyName"),
    emergencyPhone,
  };
  const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => (before[k] ?? null) !== data[k]);
  if (!changed.length) return { done: "Nothing changed." };

  await db.$transaction(async (tx) => {
    await tx.member.update({ where: { id: before.id }, data });
    await audit(
      {
        userId: user.id,
        action: "member.self_update",
        table: "Member",
        recordId: before.id,
        oldValue: Object.fromEntries(changed.map((k) => [k, before[k]])),
        newValue: Object.fromEntries(changed.map((k) => [k, data[k]])),
      },
      tx,
    );
  });
  revalidatePath("/profile");
  return { done: "Your details are saved." };
}

export async function changeMyPassword(_prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (!current) return { errors: { current: "Enter your current password." } };
  if (next.length < MIN_PASSWORD_LENGTH) return { errors: { next: `Use at least ${MIN_PASSWORD_LENGTH} characters.` } };
  if (next !== confirm) return { errors: { confirm: "The two new passwords do not match." } };
  if (next === current) return { errors: { next: "Choose a password different from the old one." } };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(record.passwordHash, current))) return { errors: { current: "Your current password is not correct." } };

  await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } });
  await audit({ userId: user.id, action: "auth.password_changed", table: "User", recordId: user.id });
  return { done: "Your password is changed. Use the new one next time you sign in." };
}
