import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "@/app/actions/auth";
import { userCount } from "@/lib/auth/session";

export const metadata = { title: "Registrati" };

export default function RegisterPage() {
  if (userCount() === 0) redirect("/setup");
  const open = process.env.ALLOW_REGISTRATION === "true";
  const invite = !!process.env.INVITE_CODE;
  if (!open && !invite) {
    return (
      <>
        <h1 className="font-display text-xl font-semibold">Registrazioni chiuse</h1>
        <p className="mt-2 text-sm text-ink-2">Chiedi a chi gestisce questa installazione di impostare un codice invito (variabile INVITE_CODE).</p>
        <Link href="/login" className="btn btn-ghost mt-4">
          Torna all&apos;accesso
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-4 font-display text-xl font-semibold">Crea il tuo account</h1>
      <AuthForm
        action={registerAction}
        submitLabel="Crea account"
        fields={[
          ...(open ? [] : [{ name: "code", label: "Codice invito" }]),
          { name: "username", label: "Nome utente", autoComplete: "username", help: "3-32 caratteri: lettere, numeri, punto, trattino." },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", help: "Almeno 10 caratteri, con lettere e numeri." },
          { name: "confirm", label: "Ripeti la password", type: "password", autoComplete: "new-password" },
        ]}
      />
      <p className="mt-4 text-sm text-ink-2">
        Hai già un account?{" "}
        <Link href="/login" className="font-semibold text-prato hover:underline">
          Accedi
        </Link>
      </p>
    </>
  );
}
