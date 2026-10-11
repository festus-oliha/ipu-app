import { OFFICER_ROLES, findCurrentUser, hasRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { buildYearWorkbook } from "@/lib/exportWorkbook";

/** The year's month sheets as an Excel file, like the old workbook. Officers only. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await findCurrentUser();
  if (!user || !hasRole(user, ...OFFICER_ROLES)) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  const year = await db.financialYear.findUnique({ where: { id } });
  if (!year) return new Response("Not found.", { status: 404 });
  const file = await buildYearWorkbook(year.id);
  await audit({ userId: user.id, action: "export.year", table: "FinancialYear", recordId: year.id });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="IPU-${year.label.replace("–", "-")}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
