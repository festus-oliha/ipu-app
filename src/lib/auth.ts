import "server-only";
import { redirect } from "next/navigation";
import { hash, verify } from "@node-rs/argon2";
import type { Role } from "@/generated/prisma/enums";
import { db } from "./db";
import { getSession } from "./session";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 8;

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

export type CurrentUser = {
  id: string;
  phone: string;
  mustChangePassword: boolean;
  roles: Role[];
  member: { id: string; memberNo: string; title: string | null; fullName: string } | null;
};

/** The signed-in user, or null. Every server action must check this itself. */
export async function findCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { roles: true, member: { select: { id: true, memberNo: true, title: true, fullName: true } } },
  });
  if (!user) return null;
  return {
    id: user.id,
    phone: user.phone,
    mustChangePassword: user.mustChangePassword,
    roles: user.roles.map((r) => r.role),
    member: user.member,
  };
}

/** Use in pages: sends the visitor to /login when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await findCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function hasRole(user: CurrentUser, ...roles: Role[]) {
  return user.roles.some((r) => roles.includes(r));
}

export const OFFICER_ROLES: Role[] = ["ADMIN", "PRESIDENT", "TREASURER", "SECRETARY", "AUDITOR"];
