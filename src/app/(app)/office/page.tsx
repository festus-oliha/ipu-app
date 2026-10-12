import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { LOG_ROLES, OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Office" };

export default async function OfficePage() {
  const user = await requireRole(...OFFICER_ROLES);
  const [receipts, exits, failed, investments] = await Promise.all([
    db.receipt.count({ where: { status: "PENDING" } }),
    db.exit.count({ where: { status: { in: ["REQUESTED", "APPROVED"] } } }),
    db.notification.count({ where: { status: "FAILED" } }),
    db.investment.count({ where: { status: "PROPOSED" } }),
  ]);
  const tiles = [
    { href: "/office/dashboard", title: "Dashboard", text: "Bank, loans, interest and what needs doing", badge: "" },
    { href: "/office/bank", title: "Bank and investments", text: "Other income, expenses, MMF and treasury bills", badge: investments ? `${investments} to approve` : "" },
    { href: "/office/exits", title: "Members leaving", text: "Exit requests and payouts", badge: exits ? `${exits} open` : "" },
    { href: "/office/year-end", title: "Year end", text: "Dividend, settlement, payouts, debtors' plans", badge: "" },
    { href: "/office/messages", title: "Messages", text: "SMS and email sent, waiting or failed; SMS spend", badge: failed ? `${failed} failed` : "" },
    { href: "/office/reports", title: "Reports", text: "Statements, loan book, income summary, Excel", badge: "" },
    { href: "/office/receipts", title: "Receipts", text: "Uploaded receipts to check", badge: receipts ? `${receipts} waiting` : "" },
    ...(hasRole(user, ...LOG_ROLES) ? [{ href: "/office/change-log", title: "Change log", text: "Every change: who, when, before and after", badge: "" }] : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="More" />
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="rounded-xl border border-line bg-white p-5 hover:border-forest">
            <p className="flex items-center justify-between gap-2 font-display text-xl text-forest">
              {t.title}
              {t.badge ? <span className="rounded-full bg-gold/15 px-2.5 py-0.5 font-sans text-xs font-semibold text-gold-dark">{t.badge}</span> : null}
            </p>
            <p className="mt-1 text-sm text-muted">{t.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
