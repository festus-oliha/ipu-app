import { findCurrentUser, hasRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { buildBackupWorkbook } from "@/lib/exportWorkbook";
import { todayLagos } from "@/lib/periods";

/** Full records (with phone numbers and bank details) — Admin and Auditor only. */
export async function GET() {
  const user = await findCurrentUser();
  if (!user || !hasRole(user, "ADMIN", "AUDITOR")) return new Response("Not allowed.", { status: 403 });
  const file = await buildBackupWorkbook();
  await audit({ userId: user.id, action: "export.backup", table: "All", recordId: todayLagos() });
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="IPU-records-${todayLagos()}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
