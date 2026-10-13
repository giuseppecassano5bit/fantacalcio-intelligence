import Link from "next/link";
import { AlertTriangle, Ban, CheckCircle2, CircleHelp, HeartPulse, ShieldAlert, XCircle, ChevronRight, Info } from "lucide-react";
import type { ProbEstimate } from "@/lib/model/evaluate";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const ROLE_BG: Record<string, string> = { P: "bg-role-p", D: "bg-role-d", C: "bg-role-c", A: "bg-role-a" };
const ROLE_NAME: Record<string, string> = { P: "Portiere", D: "Difensore", C: "Centrocampista", A: "Attaccante" };

export function RoleBadge({ role, size = "md" }: { role: string | null; size?: "sm" | "md" }) {
  const r = role ?? "?";
  return (
    <span
      title={ROLE_NAME[r] ?? "Ruolo non impostato"}
      aria-label={ROLE_NAME[r] ?? "Ruolo non impostato"}
      className={cx(
        "num inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white",
        ROLE_BG[r] ?? "bg-ink-3",
        size === "sm" ? "h-5 w-5 text-[0.75rem]" : "h-7 w-7 text-sm",
      )}
    >
      {r}
    </span>
  );
}

type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const TONE: Record<Tone, string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-warn-tint text-warn",
  bad: "bg-bad-tint text-bad",
  info: "bg-info-tint text-info",
  neutral: "bg-surface-2 text-ink-2",
};

export function Tag({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", TONE[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function StatusTag({ status, label }: { status: string; label?: string }) {
  const map: Record<string, { tone: Tone; icon: React.ReactNode; text: string }> = {
    disponibile: { tone: "ok", icon: <CheckCircle2 size={13} aria-hidden />, text: "Disponibile" },
    in_dubbio: { tone: "warn", icon: <AlertTriangle size={13} aria-hidden />, text: "In dubbio" },
    dubbio: { tone: "warn", icon: <AlertTriangle size={13} aria-hidden />, text: "In dubbio" },
    infortunato: { tone: "bad", icon: <HeartPulse size={13} aria-hidden />, text: "Infortunato" },
    squalificato: { tone: "bad", icon: <Ban size={13} aria-hidden />, text: "Squalificato" },
    indisponibile: { tone: "bad", icon: <XCircle size={13} aria-hidden />, text: "Indisponibile" },
    da_verificare: { tone: "neutral", icon: <CircleHelp size={13} aria-hidden />, text: "Da verificare" },
    fuori_rosa: { tone: "bad", icon: <XCircle size={13} aria-hidden />, text: "Non in rosa Serie A" },
    sconosciuta: { tone: "neutral", icon: <CircleHelp size={13} aria-hidden />, text: "Sconosciuta" },
  };
  const m = map[status] ?? map.da_verificare;
  return (
    <Tag tone={m.tone} icon={m.icon}>
      {label ?? m.text}
    </Tag>
  );
}

export function ReliabilityTag({ level }: { level: "alta" | "media" | "bassa" }) {
  const tone: Tone = level === "alta" ? "ok" : level === "media" ? "info" : "warn";
  return (
    <Tag tone={tone} icon={level === "bassa" ? <ShieldAlert size={13} aria-hidden /> : <Info size={13} aria-hidden />} title="Affidabilità della stima, in base a qualità e completezza dei dati">
      Affidabilità {level}
    </Tag>
  );
}

/** Arrotondamento coerente con la qualità dei dati: niente decimali ingiustificati. */
export function fmtPct(p: number, level: "alta" | "media" | "bassa" = "media"): string {
  const v = p * 100;
  if (v > 0 && v < 1) return "<1%";
  if (level !== "bassa" || v < 10) return `${Math.round(v)}%`;
  return `${Math.round(v / 5) * 5}%`;
}

export function Prob({ est, level = "media", showRange = true, label }: { est: ProbEstimate | null | undefined; level?: "alta" | "media" | "bassa"; showRange?: boolean; label?: string }) {
  if (!est) return <span className="text-ink-3">n.d.</span>;
  if (est.insufficient && level === "bassa") {
    return (
      <span className="text-ink-3" title={`Stima di ruolo usata solo dall'ottimizzatore: ${fmtPct(est.p, level)}${est.note ? `. ${est.note}` : ""}`}>
        Dati insufficienti
      </span>
    );
  }
  const range = showRange && est.high - est.low >= 0.03 ? ` (${fmtPct(est.low, level)}–${fmtPct(est.high, level)})` : "";
  return (
    <span title={`${label ? `${label}: ` : ""}stima, non certezza${est.note ? `. ${est.note}` : ""}`}>
      <span className="num font-semibold">{fmtPct(est.p, level)}</span>
      {range && <span className="text-ink-3 text-xs">{range}</span>}
      {est.insufficient && <span className="ml-1 text-xs text-warn" aria-label="campione ridotto">*</span>}
    </span>
  );
}

export function Meter({ value, max = 100, tone = "prato", label }: { value: number; max?: number; tone?: "prato" | "warn" | "bad"; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone === "prato" ? "bg-prato" : tone === "warn" ? "bg-warn" : "bg-bad";
  return (
    <span className="inline-flex items-center gap-2" aria-label={label}>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line" aria-hidden>
        <span className={cx("block h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export function Fantavalue({ index, compact = false }: { index: number | null | undefined; compact?: boolean }) {
  if (index == null) return <span className="text-ink-3">n.d.</span>;
  return (
    <span className="inline-flex items-center gap-2" title="Fantavalue: indice di convenienza 0-100, non è una probabilità">
      <span className={cx("num font-bold", compact ? "text-base" : "text-xl")}>{index}</span>
      {!compact && <Meter value={index} label={`Fantavalue ${index} su 100`} />}
    </span>
  );
}

export function Section({ title, aside, children, id, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={cx("rounded-xl border border-line bg-surface", className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface px-5 py-8 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-prose text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: Tone; children: React.ReactNode }) {
  const icon = tone === "bad" ? <XCircle size={16} aria-hidden /> : tone === "warn" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />;
  return (
    <div className={cx("flex gap-2 rounded-lg px-3 py-2 text-sm", TONE[tone])} role={tone === "bad" ? "alert" : undefined}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PlayerLink({ id, name, md }: { id: number; name: string; md?: number }) {
  return (
    <Link href={`/giocatore/${id}${md ? `?g=${md}` : ""}`} className="font-semibold hover:underline">
      {name}
    </Link>
  );
}

export function MoreLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-0.5 text-sm font-semibold text-prato hover:underline">
      {children}
      <ChevronRight size={15} aria-hidden />
    </Link>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="num text-2xl font-bold leading-tight">{value}</div>
      <div className="text-sm text-ink-2">{label}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function SourceKind({ kind }: { kind: "verificato" | "parziale" | "giornalistico" | "stima" | "manuale" }) {
  const map = {
    verificato: { tone: "ok" as Tone, t: "Dato verificato" },
    parziale: { tone: "info" as Tone, t: "Aggiornato parzialmente" },
    giornalistico: { tone: "warn" as Tone, t: "Fonte giornalistica" },
    stima: { tone: "neutral" as Tone, t: "Stima del modello" },
    manuale: { tone: "neutral" as Tone, t: "Inserito manualmente" },
  };
  return <Tag tone={map[kind].tone}>{map[kind].t}</Tag>;
}
