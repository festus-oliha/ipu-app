import { OFFICER_ROLES, findCurrentUser, hasRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { getFile } from "@/lib/storage";

/** Streams a receipt file to its owner or an officer. Never cached, never public. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const user = await findCurrentUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const receipt = await db.receipt.findUnique({ where: { id } });
  const allowed = receipt && (receipt.memberId === user.member?.id || hasRole(user, ...OFFICER_ROLES));
  if (!receipt || !allowed || !receipt.fileKey) return new Response("Not found.", { status: 404 });

  const file = await getFile(receipt.fileKey);
  if (!file) return new Response("The file could not be found in storage.", { status: 404 });
  return new Response(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
