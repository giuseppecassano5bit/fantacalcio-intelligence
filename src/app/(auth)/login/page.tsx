import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser, userCount } from "@/lib/auth/session";

export const metadata = { title: "Accedi" };

export default async function LoginPage() {
  if (userCount() === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const canRegister = process.env.ALLOW_REGISTRATION === "true" || !!process.env.INVITE_CODE;
  return (
    <>
      <h1 className="mb-4 font-display text-xl font-semibold">Accedi</h1>
      <AuthForm
        action={loginAction}
        submitLabel="Accedi"
        fields={[
          { name: "username", label: "Nome utente", autoComplete: "username" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      {canRegister && (
        <p className="mt-4 text-sm text-ink-2">
          Hai un codice invito?{" "}
          <Link href="/registrati" className="font-semibold text-prato hover:underline">
            Crea il tuo account
          </Link>
        </p>
      )}
    </>
  );
}
