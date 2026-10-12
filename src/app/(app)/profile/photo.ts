"use server";

import { revalidatePath } from "next/cache";
import type { FormResult } from "@/components/ActionForm";
import { audit } from "@/lib/audit";
import { MEMBER_ADMIN_ROLES, actionUser, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { FILE_TYPES, putFile, readUpload } from "@/lib/storage";

/** A passport photo for the ID card: the member's own, or added by the Secretary or Admin. */
export async function uploadPhoto(memberId: string, _prev: FormResult, form: FormData): Promise<FormResult> {
  const user = await actionUser();
  if (user.member?.id !== memberId && !hasRole(user, ...MEMBER_ADMIN_ROLES)) return { error: "You cannot change this member's photo." };
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) return { error: "This member no longer exists." };

  const value = form.get("photo");
  if (!value || typeof value === "string" || value.size === 0) return { errors: { photo: "Choose a photo." } };
  const file = await readUpload(value);
  if ("error" in file) return { errors: { photo: file.error } };
  if (file.type === "application/pdf") return { errors: { photo: "Choose a photo (JPG, PNG or WebP), not a PDF." } };

  const key = `photos/${member.id}/${Date.now()}.${FILE_TYPES[file.type]}`;
  try {
    await putFile(key, file.bytes, file.type);
  } catch (e) {
    return { error: `The photo could not be saved: ${(e as Error).message}` };
  }
  await db.member.update({ where: { id: member.id }, data: { photoKey: key } });
  await audit({ userId: user.id, action: "member.photo", table: "Member", recordId: member.id, oldValue: { photoKey: member.photoKey }, newValue: { photoKey: key } });
  revalidatePath("/profile");
  revalidatePath(`/office/members/${member.id}`);
  return { done: "Photo saved." };
}
