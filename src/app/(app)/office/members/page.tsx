import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, OFFICER_ROLES, hasRole, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatNaira } from "@/lib/money";
import { displayPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; show?: string }> }) {
  const user = await requireRole(...OFFICER_ROLES);
  const { q = "", show = "active" } = await searchParams;
  const term = q.trim();
  const digits = term.replace(/\D/g, "").replace(/^0/, "");

  const members = await db.member.findMany({
    where: {
      ...(show === "all" ? {} : { status: "ACTIVE" }),
      ...(term
        ? {
            OR: [
              { fullName: { contains: term, mode: "insensitive" } },
              { memberNo: { contains: term, mode: "insensitive" } },
              ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { memberNo: "asc" },
  });

  const canEdit = hasRole(user, ...MEMBER_ADMIN_ROLES);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Office" title="Members">
        {canEdit ? <LinkButton href="/office/members/new">Add member</LinkButton> : null}
      </PageHeader>

      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-60 flex-1 flex-col gap-1.5">
          <label htmlFor="q" className="text-sm font-semibold">Find a member</label>
          <input id="q" name="q" defaultValue={term} placeholder="Name, IPU number or phone" className="h-11 rounded-lg border border-line bg-white px-3 text-base" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="show" className="text-sm font-semibold">Show</label>
          <select id="show" name="show" defaultValue={show} className="h-11 rounded-lg border border-line bg-white px-3 text-base">
            <option value="active">Active members</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        <button type="submit" className="h-11 rounded-lg border border-line bg-white px-4 text-sm font-semibold hover:bg-sand">Search</button>
      </form>

      <p className="text-sm text-muted">{members.length} {members.length === 1 ? "member" : "members"}</p>

      <div className="overflow-x-auto rounded-xl border border-line bg-white">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-forest text-ivory">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">No.</th>
              <th scope="col" className="px-4 py-3 font-semibold">Name</th>
              <th scope="col" className="px-4 py-3 font-semibold">Phone</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Usual monthly</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-line hover:bg-ivory">
                <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{m.memberNo}</td>
                <td className="px-4 py-3">
                  <Link href={`/office/members/${m.id}`} className="font-semibold text-forest underline-offset-2 hover:underline">
                    {[m.title, m.fullName].filter(Boolean).join(" ")}
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums">{displayPhone(m.phone)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatNaira(m.usualMonthlyKobo, { compact: true })}</td>
                <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
              </tr>
            ))}
            {members.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  {term ? `No member matches "${term}".` : "No members yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
