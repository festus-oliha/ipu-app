import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthShell";
import { requireUser } from "@/lib/auth";
import { ChangePasswordForm } from "./ChangePasswordForm";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  return (
    <AuthShell title="Change your password">
      <ChangePasswordForm first={user.mustChangePassword} />
    </AuthShell>
  );
}
