import type { Metadata } from "next";
import Link from "next/link";
import { IdCardBack, IdCardFront } from "@/components/documents/IdCard";
import { PrintButton } from "@/components/PrintButton";
import { PageHeader } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { idCardData } from "@/lib/documents";

export const metadata: Metadata = { title: "ID cards and certificates" };

/** All members' ID cards on A4 (five per page, front beside back), plus links to certificates. */
export default async function IdCardsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireRole(...MEMBER_ADMIN_ROLES);
  const { show } = await searchParams;
  const members = await db.member.findMany({ where: { status: { not: "EXITED" } }, orderBy: { memberNo: "asc" }, select: { id: true, fullName: true, title: true, memberNo: true, photoKey: true } });
  const chosen = show === "nophoto" ? members.filter((m) => !m.photoKey) : show === "photo" ? members.filter((m) => m.photoKey) : members;
  const cards = await idCardData(chosen.map((m) => m.id));
  const noPhoto = members.filter((m) => !m.photoKey).length;
  const tab = (value: string | undefined, label: string) => (
    <Link href={value ? `?show=${value}` : "?"} aria-current={show === value ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-semibold ${show === value ? "bg-forest text-ivory" : "border border-line bg-white"}`}>{label}</Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <style>{`@media print { @page { size: A4 portrait; margin: 8mm 10mm; } }`}</style>
      <div className="print:hidden">
        <PageHeader eyebrow="Office" title="ID cards and certificates">
          <PrintButton label="Print these cards" />
        </PageHeader>
        <p className="mt-3 text-sm text-muted">
          Five cards per A4 page, front beside back. Print at 100% scale with headers and footers off, cut out each pair, fold along the middle and laminate.
          {noPhoto ? ` ${noPhoto} member${noPhoto === 1 ? " has" : "s have"} no photo yet and will show initials.` : ""}
        </p>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Which cards">
          {tab(undefined, `All (${members.length})`)}
          {tab("photo", "With photo")}
          {tab("nophoto", `No photo (${noPhoto})`)}
        </nav>
      </div>

      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 print:grid-cols-[85.6mm_85.6mm] print:justify-center print:gap-x-0 print:gap-y-[2mm]">
        {cards.map((d) => (
          <div key={d.memberId} className="contents">
            <IdCardFront d={d} />
            <IdCardBack d={d} />
          </div>
        ))}
      </div>

      <section className="print:hidden">
        <h2 className="font-display text-xl text-forest">Membership certificates</h2>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {members.map((m) => (
            <li key={m.id}><Link href={`/documents/certificate/${m.id}`} className="text-forest underline">{[m.title, m.fullName].filter(Boolean).join(" ")}</Link> <span className="text-muted">· {m.memberNo}</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
