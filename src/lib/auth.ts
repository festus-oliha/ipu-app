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

export const PAYMENT_ROLES: Role[] = ["ADMIN", "PRESIDENT", "TREASURER", "SECRETARY"];
export const MEMBER_ADMIN_ROLES: Role[] = ["ADMIN", "SECRETARY"];
/** Who may read the change log. */
export const LOG_ROLES: Role[] = ["ADMIN", "AUDITOR"];

/** Use in pages: signed-in user holding one of the roles, else back to home. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  if (!hasRole(user, ...roles)) redirect("/");
  return user;
}

export class NotAllowedError extends Error {
  constructor() {
    super("You are not allowed to do this.");
  }
}

/** Use in server actions: never trust that a hidden button stops anyone. */
export async function actionUser(...roles: Role[]): Promise<CurrentUser> {
  const user = await findCurrentUser();
  if (!user || user.mustChangePassword) redirect("/login");
  if (roles.length && !hasRole(user, ...roles)) throw new NotAllowedError();
  return user;
}

/** A temporary password that is easy to read out over the phone: e.g. "ipu-4827-kz". */
export function temporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const digits = Array.from(bytes.slice(0, 4), (b) => String(b % 10)).join("");
  const tail = Array.from(bytes.slice(4), (b) => letters[b % letters.length]).join("");
  return `ipu-${digits}-${tail}`;
}
