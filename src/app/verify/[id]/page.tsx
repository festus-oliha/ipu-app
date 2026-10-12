import type { Metadata } from "next";
import { Seal } from "@/components/Seal";
import { db } from "@/lib/db";
import { fullName } from "@/lib/documents";
import { currentYear, formatDate } from "@/lib/periods";

export const metadata: Metadata = { title: "Check a member card", robots: { index: false } };

/**
 * Public page the ID card's QR code opens. Shows only what is printed on the
 * card (name, number, whether membership is current): no phone, money or photo.
 */
export default async function VerifyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = /^[a-z0-9]{20,40}$/.test(id) ? await db.member.findUnique({ where: { id }, select: { title: true, fullName: true, memberNo: true, status: true } }) : null;
  const year = await currentYear();
  const valid = member?.status === "ACTIVE";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center gap-5 px-5 py-12 text-center">
      <Seal size={88} />
      <p className="font-display text-2xl text-forest">Iyobor Progressive Union</p>
      {member ? (
        <div className={`w-full rounded-xl border-2 p-6 ${valid ? "border-forest bg-white" : "border-danger bg-white"}`}>
          <p className={`text-sm font-semibold tracking-[0.2em] uppercase ${valid ? "text-forest" : "text-danger"}`}>
            {valid ? "✓ Current member" : member.status === "EXITED" ? "✗ No longer a member" : "✗ Membership suspended"}
          </p>
          <p className="mt-3 font-display text-2xl text-ink">{fullName(member)}</p>
          <p className="text-muted">{member.memberNo}</p>
          {valid && year ? <p className="mt-3 text-sm text-muted">Card valid to {formatDate(year.endDate)}</p> : null}
          <p className="mt-3 text-xs text-muted">Checked {new Date().toLocaleString("en-GB", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}</p>
        </div>
      ) : (
        <div className="w-full rounded-xl border-2 border-danger bg-white p-6">
          <p className="font-semibold text-danger">This card is not on our records.</p>
          <p className="mt-2 text-sm text-muted">Please contact the union on +234 907 672 9480.</p>
        </div>
      )}
    </main>
  );
}
