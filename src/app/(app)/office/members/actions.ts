"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@/generated/prisma/enums";
import { audit } from "@/lib/audit";
import { MEMBER_ADMIN_ROLES, actionUser, hashPassword, temporaryPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { nextMemberNo, parseMemberForm } from "@/lib/memberInput";

export type MemberFormState = {
  errors?: Record<string, string>;
  values?: Record<string, string>;
  error?: string;
  saved?: { memberId: string; memberNo: string; fullName: string; tempPassword?: string };
};

async function phoneTaken(phone: string, exceptMemberId?: string) {
  const [member, user] = await Promise.all([
    db.member.findUnique({ where: { phone } }),
    db.user.findUnique({ where: { phone }, include: { member: true } }),
  ]);
  if (member && member.id !== exceptMemberId) return true;
  if (user && user.member?.id !== exceptMemberId) return true;
  return false;
}

export async function createMember(_prev: MemberFormState, form: FormData): Promise<MemberFormState> {
  const officer = await actionUser(...MEMBER_ADMIN_ROLES);
  const { errors, values, data } = parseMemberForm(form);
  if (!errors.phone && (await phoneTaken(data.phone))) errors.phone = "Another member already uses this phone number.";
  if (Object.keys(errors).length) return { errors, values };

  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  const member = await db.$transaction(async (tx) => {
    const numbers = await tx.member.findMany({ select: { memberNo: true } });
    const user = await tx.user.create({
      data: { phone: data.phone, passwordHash, mustChangePassword: true, roles: { create: [{ role: "MEMBER" }] } },
    });
    const created = await tx.member.create({
      data: { ...data, memberNo: nextMemberNo(numbers.map((n) => n.memberNo)), userId: user.id },
    });
    await audit({ userId: officer.id, action: "member.create", table: "Member", recordId: created.id, newValue: created }, tx);
    return created;
  });

  revalidatePath("/office/members");
  return { saved: { memberId: member.id, memberNo: member.memberNo, fullName: member.fullName, tempPassword } };
}

export async function updateMember(memberId: string, _prev: MemberFormState, form: FormData): Promise<MemberFormState> {
  const officer = await actionUser(...MEMBER_ADMIN_ROLES);
  const before = await db.member.findUnique({ where: { id: memberId } });
  if (!before) return { error: "This member no longer exists." };

  const { errors, values, data } = parseMemberForm(form);
  if (!errors.phone && data.phone !== before.phone && (await phoneTaken(data.phone, memberId))) {
    errors.phone = "Another member already uses this phone number.";
  }
  if (Object.keys(errors).length) return { errors, values };

  const after = await db.$transaction(async (tx) => {
    const updated = await tx.member.update({
      where: { id: memberId },
      data: { ...data, exitedAt: data.status === "EXITED" ? (before.exitedAt ?? new Date()) : null },
    });
    if (before.userId && data.phone !== before.phone) {
      await tx.user.update({ where: { id: before.userId }, data: { phone: data.phone } });
    }
    await audit({ userId: officer.id, action: "member.update", table: "Member", recordId: memberId, oldValue: before, newValue: updated }, tx);
    return updated;
  });

  revalidatePath("/office/members");
  revalidatePath(`/office/members/${memberId}`);
  return { saved: { memberId, memberNo: after.memberNo, fullName: after.fullName } };
}

export type ResetState = { tempPassword?: string; error?: string };

export async function resetMemberPassword(memberId: string): Promise<ResetState> {
  const officer = await actionUser(...MEMBER_ADMIN_ROLES);
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) return { error: "This member no longer exists." };

  const tempPassword = temporaryPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.$transaction(async (tx) => {
    let userId = member.userId;
    if (userId) {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true, failedAttempts: 0, lockedUntil: null },
      });
    } else {
      const user = await tx.user.create({
        data: { phone: member.phone, passwordHash, mustChangePassword: true, roles: { create: [{ role: "MEMBER" }] } },
      });
      userId = user.id;
      await tx.member.update({ where: { id: member.id }, data: { userId } });
    }
    await audit({ userId: officer.id, action: "member.password_reset", table: "User", recordId: userId }, tx);
  });

  return { tempPassword };
}

const OFFICE_ROLES: Role[] = ["ADMIN", "PRESIDENT", "TREASURER", "SECRETARY", "AUDITOR"];
export type RolesState = { ok?: boolean; error?: string };

export async function setMemberRoles(memberId: string, _prev: RolesState, form: FormData): Promise<RolesState> {
  const admin = await actionUser("ADMIN");
  const member = await db.member.findUnique({ where: { id: memberId }, include: { user: { include: { roles: true } } } });
  if (!member?.user) return { error: "This member has no login yet. Reset the password first to create one." };

  const chosen = OFFICE_ROLES.filter((r) => form.get(r) === "on");
  if (member.user.id === admin.id && !chosen.includes("ADMIN")) {
    return { error: "You cannot remove your own Admin role. Ask another Admin to do it." };
  }
  const before = member.user.roles.map((r) => r.role);
  const next: Role[] = ["MEMBER", ...chosen];

  await db.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: member.user!.id } });
    await tx.userRole.createMany({ data: next.map((role) => ({ userId: member.user!.id, role })) });
    await audit({ userId: admin.id, action: "member.roles", table: "User", recordId: member.user!.id, oldValue: before, newValue: next }, tx);
  });

  revalidatePath(`/office/members/${memberId}`);
  return { ok: true };
}
