import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IdCardBack, IdCardFront } from "@/components/documents/IdCard";
import { PrintButton } from "@/components/PrintButton";
import { Notice } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { idCardData } from "@/lib/documents";

export const metadata: Metadata = { title: "ID card" };

/** One member's ID card, front and back, printed at real card size. */
export default async function IdCardPage({ params }: { params: Promise<{ memberId: string }> }) {
  const user = await requireUser();
  const { memberId } = await params;
  const own = user.member?.id === memberId;
  if (!own && !hasRole(user, ...OFFICER_ROLES)) notFound();
  const [d] = await idCardData([memberId]);
  if (!d) return <Notice tone="warning">There is no ID card for this member (they may have left the union).</Notice>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={own ? "/profile" : `/office/members/${memberId}`} className="text-sm text-forest underline">← Back</Link>
        <PrintButton />
      </div>
      {!d.photoVersion ? (
        <div className="print:hidden">
          <Notice tone="warning">No photo yet: the card shows initials instead. {own ? <>Add a photo on <Link href="/profile" className="underline">My profile</Link>.</> : "Add one on the member's page."}</Notice>
        </div>
      ) : null}
      <p className="text-sm text-muted print:hidden">Prints at bank-card size (85.6 × 54 mm). Set scale to 100% and turn off headers and footers, then cut out, fold along the middle and laminate.</p>
      <div className="grid max-w-[48rem] gap-4 sm:grid-cols-2 print:flex print:max-w-none print:gap-0">
        <IdCardFront d={d} />
        <IdCardBack d={d} />
      </div>
    </div>
  );
}
