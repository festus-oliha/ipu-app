import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";
import type { Role } from "@/generated/prisma/client";
import { db } from "./db";
import { currentYear, formatDate } from "./periods";

export const fullName = (m: { title: string | null; fullName: string }) => [m.title, m.fullName].filter(Boolean).join(" ");

export const ROLE_NAMES: Partial<Record<Role, string>> = { PRESIDENT: "President", TREASURER: "Treasurer", SECRETARY: "Secretary", AUDITOR: "Auditor", ADMIN: "Admin" };

/** Who holds each office now, for signature lines. */
export async function officeHolders() {
  const users = await db.user.findMany({
    where: { roles: { some: { role: { in: ["PRESIDENT", "TREASURER", "SECRETARY"] } } } },
    include: { roles: true, member: true },
  });
  const holder = (role: Role) => {
    const u = users.find((x) => x.roles.some((r) => r.role === role));
    return u?.member ? fullName(u.member) : "";
  };
  return { president: holder("PRESIDENT"), treasurer: holder("TREASURER"), secretary: holder("SECRETARY") };
}

/** The public address of the app (Netlify sets URL; otherwise from the request). */
export async function siteOrigin() {
  if (process.env.URL) return process.env.URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** A QR code as inline SVG markup, in the brand's forest green. */
export function qrSvg(text: string) {
  return QRCode.toString(text, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1e4d3aff", light: "#ffffff00" } });
}

/** Everything printed on a member's ID card. */
export async function idCardData(memberIds: string[]) {
  const [members, year, signers, origin] = await Promise.all([
    db.member.findMany({ where: { id: { in: memberIds }, status: { not: "EXITED" } }, include: { user: { include: { roles: true } } }, orderBy: { memberNo: "asc" } }),
    currentYear(),
    officeHolders(),
    siteOrigin(),
  ]);
  return Promise.all(
    members.map(async (m) => {
      const offices = (m.user?.roles ?? []).map((r) => r.role).filter((r) => r !== "MEMBER" && r !== "ADMIN").map((r) => ROLE_NAMES[r]!);
      const verifyUrl = `${origin}/verify/${m.id}`;
      return {
        memberId: m.id,
        memberNo: m.memberNo,
        name: fullName(m),
        office: offices.length ? offices.join(", ") : "Member",
        photoVersion: m.photoKey,
        validTo: year ? formatDate(year.endDate) : "",
        verifyUrl,
        qrSvg: await qrSvg(verifyUrl),
        secretary: signers.secretary,
      };
    }),
  );
}

export type LetterKind = "agreement" | "clearance" | "notice";

/** Which letters a loan can have, by its status. */
export function lettersFor(status: string): { kind: LetterKind; label: string }[] {
  const out: { kind: LetterKind; label: string }[] = [];
  if (["APPROVED", "DISBURSED", "CLOSED", "DEFAULTED"].includes(status)) out.push({ kind: "agreement", label: "Loan agreement" });
  if (status === "CLOSED") out.push({ kind: "clearance", label: "Clearance letter" });
  if (status === "DEFAULTED") out.push({ kind: "notice", label: "Notice of default" });
  return out;
}
