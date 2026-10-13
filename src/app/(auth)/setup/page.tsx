import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { registerAction } from "@/app/actions/auth";
import { userCount } from "@/lib/auth/session";

export const metadata = { title: "Primo accesso" };

export default function SetupPage() {
  if (userCount() > 0) redirect("/login");
  const needsToken = !!process.env.SETUP_TOKEN;
  return (
    <>
      <h1 className="font-display text-xl font-semibold">Crea il tuo account</h1>
      <p className="mb-4 mt-1 text-sm text-ink-2">È il primo accesso a questa installazione: l&apos;account che crei ora sarà l&apos;amministratore.</p>
      <AuthForm
        action={registerAction}
        submitLabel="Crea account"
        fields={[
          ...(needsToken ? [{ name: "code", label: "Codice di configurazione", help: "Il valore della variabile SETUP_TOKEN del server." }] : []),
          { name: "username", label: "Nome utente", autoComplete: "username", help: "3-32 caratteri: lettere, numeri, punto, trattino." },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", help: "Almeno 10 caratteri, con lettere e numeri." },
          { name: "confirm", label: "Ripeti la password", type: "password", autoComplete: "new-password" },
        ]}
      />
    </>
  );
}
