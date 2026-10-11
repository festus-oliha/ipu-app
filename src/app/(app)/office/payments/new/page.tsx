import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { PAYMENT_ROLES, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { positionsThrough } from "@/lib/loans";
import { todayLagos } from "@/lib/periods";
import { PaymentForm } from "./PaymentForm";

export const metadata: Metadata = { title: "Record payment" };

export default async function RecordPaymentPage({ searchParams }: { searchParams: Promise<{ member?: string }> }) {
  await requireRole(...PAYMENT_ROLES);
  const { member: memberNo } = await searchParams;
  const members = await db.member.findMany({
    where: { status: { not: "EXITED" } },
    orderBy: { memberNo: "asc" },
    select: { id: true, memberNo: true, title: true, fullName: true, usualMonthlyKobo: true },
  });
  const positions = await positionsThrough(new Date(Date.UTC(2100, 0, 1)));
  const loanText = (id: string) => {
    const p = positions.get(id);
    if (!p || (p.principal <= 0n && p.interestOwed === 0n)) return undefined;
    const interest = p.interestOwed > 0n ? `interest owed ${formatNaira(p.interestOwed, { compact: true })}` : p.interestOwed < 0n ? `interest credit ${formatNaira(-p.interestOwed, { compact: true })}` : "no interest owed";
    return `Loan balance ${formatNaira(p.principal, { compact: true })}, ${interest}`;
  };
  const options = members.map((m) => ({
    label: `${m.memberNo} · ${[m.title, m.fullName].filter(Boolean).join(" ")}`,
    usual: formatNaira(m.usualMonthlyKobo, { compact: true }),
    loan: loanText(m.id),
  }));
  const preselect = memberNo ? options.find((o) => o.label.startsWith(`${memberNo} `))?.label : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Record a payment" />
      <p className="-mt-3 max-w-prose text-sm text-muted">
        Enter money a member has paid into the union&apos;s GT Bank account. It is added to the month of the
        date you enter, recorded under your name, and the member gets an SMS.
      </p>
      <Card>
        <PaymentForm members={options} today={todayLagos()} preselect={preselect} />
      </Card>
    </div>
  );
}
