import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { findCurrentUser } from "@/lib/auth";
import { settingsAt } from "@/lib/settings";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await findCurrentUser()) redirect("/");
  return (
    <AuthShell title="Sign in">
      <LoginForm adminPhone={(await settingsAt()).adminPhone} />
    </AuthShell>
  );
}
