"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";

export function AuthForm({
  action,
  submitLabel,
  fields,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  submitLabel: string;
  fields: { name: string; label: string; type?: string; autoComplete?: string; help?: string; required?: boolean }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-sm font-semibold">{f.label}</span>
          <input className="input" name={f.name} type={f.type ?? "text"} autoComplete={f.autoComplete} required={f.required ?? true} />
          {f.help && <span className="mt-1 block text-xs text-ink-3">{f.help}</span>}
        </label>
      ))}
      {state.error && (
        <p className="rounded-lg bg-bad-tint px-3 py-2 text-sm text-bad" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p className="rounded-lg bg-ok-tint px-3 py-2 text-sm text-ok">{state.ok}</p>}
      <button className="btn btn-primary w-full justify-center" disabled={pending}>
        {pending ? "Attendere…" : submitLabel}
      </button>
    </form>
  );
}
