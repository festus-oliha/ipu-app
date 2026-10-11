import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { MEMBER_ADMIN_ROLES, requireRole } from "@/lib/auth";
import { createMember } from "../actions";
import { MemberForm } from "../MemberForm";

export const metadata: Metadata = { title: "Add member" };

export default async function NewMemberPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  await requireRole(...MEMBER_ADMIN_ROLES);
  const { after = "" } = await searchParams;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Members" title="Add a member" />
      <Card>
        <MemberForm key={after} action={createMember} initial={{}} mode="new" />
      </Card>
    </div>
  );
}
