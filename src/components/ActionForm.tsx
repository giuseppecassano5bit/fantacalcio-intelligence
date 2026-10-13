"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";

/** Form collegato a una server action che restituisce un messaggio di esito. */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  submitClassName = "btn btn-primary",
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? "space-y-3"}>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button className={submitClassName} disabled={pending}>
          {pending ? "Salvataggio…" : submitLabel}
        </button>
        {state.error && (
          <span className="text-sm text-bad" role="alert">
            {state.error}
          </span>
        )}
        {state.ok && (
          <span className="text-sm text-ok" role="status">
            {state.ok}
          </span>
        )}
      </div>
    </form>
  );
}

export function Field({ label, children, help, className }: { label: string; children: React.ReactNode; help?: string; className?: string }) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-ink-3">{help}</span>}
    </label>
  );
}
