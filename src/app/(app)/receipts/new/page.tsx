import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { memberPosition } from "@/lib/loans";
import { todayLagos } from "@/lib/periods";
import { ReceiptForm } from "./ReceiptForm";

export const metadata: Metadata = { title: "Upload receipt" };

export default async function UploadReceiptPage() {
  const user = await requireUser();
  const position = user.member ? await memberPosition(user.member.id) : null;
  const hasLoan = Boolean(position && (position.principal > 0n || position.interestOwed > 0n));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Payments" title="Upload a receipt" />
      <p className="-mt-3 max-w-prose text-sm text-muted">
        After paying into GT Bank, account 0033550876, send a photo of the receipt here. The Treasurer checks it against the bank
        statement; once confirmed it counts towards your savings and you get an SMS.
      </p>
      <Card>
        {user.member ? <ReceiptForm today={todayLagos()} hasLoan={hasLoan} /> : <p className="text-sm">Your login is not linked to a member record.</p>}
      </Card>
    </div>
  );
}
