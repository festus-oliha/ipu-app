import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requireRole(...OFFICER_ROLES);
  const years = await db.financialYear.findMany({ orderBy: { startDate: "desc" } });
  const link = "font-semibold text-forest underline underline-offset-2";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Reports" />
      <p className="-mt-3 max-w-prose text-sm text-muted">
        Reports open as pages with the union letterhead. Use &ldquo;Print or save as PDF&rdquo; on each one; on a phone choose &ldquo;Save as PDF&rdquo; as the printer.
      </p>
      {years.map((y) => (
        <Card key={y.id} title={`${y.label}${y.status === "CLOSED" ? " (closed)" : ""}`}>
          <ul className="flex flex-col gap-3 text-sm">
            <li><Link className={link} href={`/office/reports/income?year=${encodeURIComponent(y.label)}`}>Income and bank summary</Link>: money in and out, what the union earned, dividends.</li>
            <li><Link className={link} href={`/office/reports/loans?year=${encodeURIComponent(y.label)}`}>Loan book</Link>: every loan with guarantor, balance and interest owed.</li>
            <li><a className={link} href={`/exports/year/${y.id}`}>Monthly sheets (Excel)</a>: one tab per month, like the old workbook.</li>
            {y.status === "CLOSED" ? <li><Link className={link} href="/office/year-end">Year-end settlement</Link>: payouts and debtors.</li> : null}
          </ul>
        </Card>
      ))}
      <Card title="Members">
        <p className="text-sm">Each member&apos;s statement opens from their page under <Link className={link} href="/office/members">Members</Link>. Members can print their own from the home page.</p>
      </Card>
      {hasRole(user, "ADMIN", "AUDITOR") ? (
        <Card title="Full records">
          <p className="mb-3 text-sm">Every member, ledger entry, loan, settlement and investment in one Excel file. It holds phone numbers and bank details: keep it private. It is also emailed to the Admin on the 1st of each month.</p>
          <a className={link} href="/exports/backup">Download full records (Excel)</a>
        </Card>
      ) : null}
    </div>
  );
}
