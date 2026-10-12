import { OFFICER_ROLES, findCurrentUser, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** A member's ID-card photo, for the member and officers only. */
export async function GET(_req: Request, ctx: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await ctx.params;
  const user = await findCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  if (user.member?.id !== memberId && !hasRole(user, ...OFFICER_ROLES)) return new Response("Not found.", { status: 404 });

  const member = await db.member.findUnique({ where: { id: memberId }, select: { photoKey: true } });
  const file = member?.photoKey ? await getFile(member.photoKey) : null;
  if (!file || file.type === "application/pdf") return new Response("Not found.", { status: 404 });
  return new Response(Buffer.from(file.bytes), {
    headers: { "Content-Type": file.type, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}
