import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { Seal } from "@/components/Seal";
import { Notice } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fullName, officeHolders } from "@/lib/documents";
import { formatDate, todayLagos } from "@/lib/periods";

export const metadata: Metadata = { title: "Membership certificate" };

function Signature({ name, office }: { name: string; office: string }) {
  return (
    <div className="flex w-[26cqw] flex-col items-center text-center">
      <div className="h-[4.5cqw] w-full border-b border-ink/70" />
      <p className="mt-[0.6cqw] font-display text-[1.6cqw] text-ink">{name || " "}</p>
      <p className="text-[1.1cqw] tracking-[0.2em] text-gold-dark uppercase">{office}</p>
    </div>
  );
}

/** Certificate of membership: printed on A4 landscape, signed by the President and Secretary. */
export default async function CertificatePage({ params }: { params: Promise<{ memberId: string }> }) {
  const user = await requireUser();
  const { memberId } = await params;
  if (user.member?.id !== memberId && !hasRole(user, ...OFFICER_ROLES)) notFound();
  const member = await db.member.findUnique({ where: { id: memberId } });
  if (!member) notFound();
  if (member.status === "EXITED") {
    return <Notice tone="warning">{fullName(member)} has left the union, so a membership certificate cannot be printed.</Notice>;
  }
  const signers = await officeHolders();
  const since = member.yearJoined ?? member.joinedAt.getUTCFullYear();
  const issued = formatDate(new Date(`${todayLagos()}T00:00:00Z`));

  return (
    <div className="flex flex-col gap-4">
      <style>{`@media print { @page { size: A4 landscape; margin: 0; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={user.member?.id === memberId ? "/profile" : `/office/members/${memberId}`} className="text-sm text-forest underline">← Back</Link>
        <PrintButton label="Print or save as PDF" />
      </div>
      <p className="text-sm text-muted print:hidden">In the print window choose <strong>Landscape</strong> and turn off <strong>Headers and footers</strong>. Print on white or cream card for the best result.</p>

      <article className="@container mx-auto aspect-[297/210] w-full max-w-[60rem] bg-white shadow-sm print:aspect-auto print:h-[210mm] print:w-[297mm] print:max-w-none print:shadow-none">
        <div className="relative flex h-full flex-col items-center p-[2.2cqw]">
          {/* Double frame in the brand colours */}
          <div className="absolute inset-[1.6cqw] border-[0.5cqw] border-forest" />
          <div className="absolute inset-[2.6cqw] border-[0.15cqw] border-gold" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.05]"><Seal size={420} variant="mono" className="h-[55cqw] w-[55cqw]" /></div>

          <div className="relative flex h-full flex-col items-center justify-between px-[7cqw] py-[3.5cqw] text-center">
            <div className="flex flex-col items-center">
              <Seal size={120} className="h-[10cqw] w-[10cqw]" />
              <p className="mt-[1cqw] font-display text-[2.6cqw] tracking-[0.08em] text-forest uppercase">Iyobor Progressive Union</p>
              <p className="text-[1.1cqw] tracking-[0.3em] text-gold-dark uppercase">Unity · Thrift · Progress</p>
            </div>

            <div className="flex flex-col items-center">
              <h1 className="font-display text-[4.4cqw] leading-none text-ink">Certificate of Membership</h1>
              <p className="mt-[2cqw] text-[1.5cqw] text-muted italic">This is to certify that</p>
              <p className="mt-[0.8cqw] border-b-[0.15cqw] border-gold px-[3cqw] pb-[0.4cqw] font-display text-[4.2cqw] leading-tight text-forest">{fullName(member)}</p>
              <p className="mt-[1.6cqw] max-w-[70cqw] text-[1.45cqw] leading-relaxed text-ink">
                is a registered member of the Iyobor Progressive Union, Benin City, Edo State, under membership number{" "}
                <strong className="font-semibold">{member.memberNo}</strong>, admitted in {since}, and is entitled to the rights and
                privileges of membership, subject to the rules of the Union.
              </p>
            </div>

            <div className="flex w-full items-end justify-between">
              <Signature name={signers.president} office="President" />
              <div className="flex flex-col items-center text-[1.1cqw] text-muted">
                <span>Issued {issued}</span>
                <span>198, Old Sapele Road, Benin City</span>
              </div>
              <Signature name={signers.secretary} office="Secretary" />
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
