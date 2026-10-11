"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { getSession } from "@/lib/session";
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  MIN_PASSWORD_LENGTH,
  findCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export type FormState = { error?: string; ok?: string; phone?: string };

const WRONG = "Phone number or password is not correct.";

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = z
    .object({ phone: z.string().min(1), password: z.string().min(1) })
    .safeParse({ phone: formData.get("phone"), password: formData.get("password") });
  const typed = String(formData.get("phone") ?? "");
  if (!parsed.success) return { error: "Enter your phone number and password.", phone: typed };

  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return { error: "Enter a Nigerian phone number, e.g. 0803 445 3367.", phone: typed };

  const user = await db.user.findUnique({ where: { phone } });
  if (!user) return { error: WRONG, phone: typed };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return { error: `Too many wrong attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, phone: typed };
  }

  if (!(await verifyPassword(user.passwordHash, parsed.data.password))) {
    const failed = user.failedAttempts + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS;
    await db.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
      },
    });
    await db.auditLog.create({
      data: { userId: user.id, action: lock ? "auth.locked" : "auth.failed", table: "User", recordId: user.id },
    });
    return { error: lock ? `Too many wrong attempts. Account locked for ${LOCK_MINUTES} minutes.` : WRONG, phone: typed };
  }

  await db.user.update({ where: { id: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
  await db.auditLog.create({ data: { userId: user.id, action: "auth.login", table: "User", recordId: user.id } });

  const session = await getSession();
  session.userId = user.id;
  await session.save();

  redirect(user.mustChangePassword ? "/change-password" : "/");
}

export async function logout() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await findCurrentUser();
  if (!user) redirect("/login");

  const parsed = z
    .object({
      current: z.string().min(1),
      next: z.string().min(MIN_PASSWORD_LENGTH),
      confirm: z.string(),
    })
    .safeParse({ current: formData.get("current"), next: formData.get("next"), confirm: formData.get("confirm") });
  if (!parsed.success) return { error: `Your new password must have at least ${MIN_PASSWORD_LENGTH} characters.` };
  if (parsed.data.next !== parsed.data.confirm) return { error: "The two new passwords do not match." };
  if (parsed.data.next === parsed.data.current) return { error: "Choose a password different from the old one." };

  const record = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  if (!(await verifyPassword(record.passwordHash, parsed.data.current))) {
    return { error: "Your current password is not correct." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false },
  });
  await db.auditLog.create({ data: { userId: user.id, action: "auth.password_changed", table: "User", recordId: user.id } });

  redirect("/");
}
