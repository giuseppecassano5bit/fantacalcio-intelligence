"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/lib/auth/session";
import { bumpDataVersion, getDb } from "@/lib/db";
import { addToRoster, removeFromRoster, replaceInRoster, updateRosterEntry, upsertPlayer, updatePlayerManual, type PlayerStatus } from "@/lib/repo/players";
import { addAvailability, addEditorial, deleteEditorial, deleteLineupReport, resolveAvailability, saveLeagueSettings, upsertLineupReport, type AvailabilityKind, type Certainty, type LineupStatus, type Verdict } from "@/lib/repo/data";
import { findMatchForTeam, setTeamNotes } from "@/lib/repo/league";
import { setConnectorEnabled } from "@/lib/repo/sync";
import { classicModule, CLASSIC_MODULES, leagueConfigSchema, MANTRA_MODULES_PROVVISORI, type LeagueConfig, type RoleClassic } from "@/lib/domain/settings";
import { saveLineup } from "@/lib/analysis/recommend";
import type { FormState } from "./auth";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const numOrNull = (f: FormData, k: string) => {
  const v = str(f, k).replace(",", ".");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isUrl = (u: string) => !u || /^https?:\/\/\S+$/i.test(u);
const ROLE = new Set(["P", "D", "C", "A"]);

function refreshAll() {
  revalidatePath("/", "layout");
}

// ---------------- Rosa ----------------

export async function addPlayerToRosterAction(form: FormData) {
  const { user, db } = await requireContext();
  const id = Number(form.get("playerId"));
  if (id) addToRoster(db, user.id, id, { price: numOrNull(form, "price") });
  bumpDataVersion(db);
  refreshAll();
}

export async function removeFromRosterAction(form: FormData) {
  const { user, db } = await requireContext();
  removeFromRoster(db, user.id, Number(form.get("playerId")), str(form, "reason"));
  bumpDataVersion(db);
  refreshAll();
}

export async function replaceInRosterAction(form: FormData) {
  const { user, db } = await requireContext();
  const outId = Number(form.get("outId"));
  const inId = Number(form.get("inId"));
  if (outId && inId) replaceInRoster(db, user.id, outId, inId);
  bumpDataVersion(db);
  refreshAll();
}

export async function updateRosterEntryAction(form: FormData) {
  const { user, db } = await requireContext();
  updateRosterEntry(db, user.id, Number(form.get("playerId")), { notes: str(form, "notes") || null, price: numOrNull(form, "price") });
  refreshAll();
}

/** Inserimento manuale di un giocatore non riconosciuto (marcato come non verificato). */
export async function createManualPlayerAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const name = str(form, "name");
  const role = str(form, "role").toUpperCase();
  const team = str(form, "team");
  if (name.length < 2) return { error: "Inserisci nome e cognome." };
  if (!ROLE.has(role)) return { error: "Scegli il ruolo (P, D, C, A)." };
  const res = upsertPlayer(db, { fullName: name, team: team || null, roleClassic: role as RoleClassic, roleClassicSource: "manuale", rolesMantra: str(form, "rolesMantra") || null, source: "manuale", origin: "manuale" });
  addToRoster(db, user.id, res.id, { price: numOrNull(form, "price") });
  bumpDataVersion(db);
  refreshAll();
  return { ok: res.created ? `${name} aggiunto come giocatore inserito manualmente (da verificare).` : `${name} era già nel catalogo ed è stato aggiunto alla rosa.` };
}

export async function updatePlayerAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const id = Number(form.get("playerId"));
  const role = str(form, "role").toUpperCase();
  const status = str(form, "status") as PlayerStatus;
  const pen = str(form, "penaltyOrder");
  updatePlayerManual(
    db,
    id,
    {
      fullName: str(form, "name") || undefined,
      team: str(form, "team") || null,
      roleClassic: ROLE.has(role) ? (role as RoleClassic) : null,
      rolesMantra: str(form, "rolesMantra") || null,
      status: ["disponibile", "in_dubbio", "infortunato", "squalificato", "da_verificare", "fuori_rosa"].includes(status) ? status : undefined,
      penaltyOrder: pen === "" ? null : Number(pen),
    },
    user.username,
  );
  bumpDataVersion(db);
  refreshAll();
  return { ok: "Dati del giocatore aggiornati." };
}

// ---------------- Informazioni manuali (con fonte obbligatoria) ----------------

export async function addAvailabilityAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const source = str(form, "source");
  const url = str(form, "url");
  if (!source) return { error: "Indica la fonte dell'informazione." };
  if (!isUrl(url)) return { error: "URL non valido." };
  addAvailability(db, {
    playerId: Number(form.get("playerId")),
    kind: (str(form, "kind") || "infortunio") as AvailabilityKind,
    certainty: (str(form, "certainty") || "dubbio") as Certainty,
    description: str(form, "description") || null,
    expectedReturn: str(form, "expectedReturn") || null,
    source,
    url: url || null,
    reportedAt: str(form, "reportedAt") ? new Date(str(form, "reportedAt")).toISOString() : undefined,
    origin: "manuale",
    createdBy: user.id,
  });
  bumpDataVersion(db);
  refreshAll();
  return { ok: "Segnalazione registrata." };
}

export async function resolveAvailabilityAction(form: FormData) {
  const { db } = await requireContext();
  resolveAvailability(db, Number(form.get("id")));
  bumpDataVersion(db);
  refreshAll();
}

/** Conferma una indiscrezione giornalistica come segnalazione verificata dall'utente. */
export async function confirmRumorAction(form: FormData) {
  const { user, db } = await requireContext();
  const id = Number(form.get("id"));
  const certainty = (str(form, "certainty") || "dubbio") as Certainty;
  const row = db.prepare("SELECT * FROM availability_reports WHERE id = ?").get(id) as { player_id: number; kind: AvailabilityKind; description: string | null; source: string; url: string | null } | undefined;
  if (row) {
    resolveAvailability(db, id);
    addAvailability(db, { playerId: row.player_id, kind: row.kind, certainty, description: row.description, source: `${row.source}, verificato da ${user.username}`, url: row.url, origin: "manuale", createdBy: user.id });
  }
  bumpDataVersion(db);
  refreshAll();
}

export async function addLineupReportAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const playerId = Number(form.get("playerId"));
  const matchday = Number(form.get("matchday"));
  const teamId = Number(form.get("teamId"));
  const source = str(form, "source");
  const url = str(form, "url");
  if (!source) return { error: "Indica la fonte della probabile formazione." };
  if (!isUrl(url)) return { error: "URL non valido." };
  const match = findMatchForTeam(db, teamId, matchday);
  if (!match) return { error: "Nessuna partita della squadra in questa giornata." };
  const prob = numOrNull(form, "probability");
  upsertLineupReport(db, {
    matchId: match.id,
    playerId,
    source,
    kind: str(form, "kind") === "ufficiale" ? "ufficiale" : "probabile",
    status: (str(form, "status") || "titolare") as LineupStatus,
    probability: prob == null ? null : prob > 1 ? prob / 100 : prob,
    url: url || null,
    origin: "manuale",
    createdBy: user.id,
  });
  bumpDataVersion(db);
  refreshAll();
  return { ok: "Indicazione registrata." };
}

export async function deleteLineupReportAction(form: FormData) {
  const { db } = await requireContext();
  deleteLineupReport(db, Number(form.get("id")));
  bumpDataVersion(db);
  refreshAll();
}

export async function addEditorialAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const source = str(form, "source");
  const url = str(form, "url");
  if (!source) return { error: "Indica la fonte del parere." };
  if (!isUrl(url)) return { error: "URL non valido." };
  addEditorial(db, user.id, {
    playerId: Number(form.get("playerId")),
    matchday: numOrNull(form, "matchday"),
    source,
    verdict: (str(form, "verdict") || "neutrale") as Verdict,
    explicitAdvice: form.get("explicit") === "on",
    summary: str(form, "summary") || null,
    url: url || null,
    publishedAt: str(form, "publishedAt") ? new Date(str(form, "publishedAt")).toISOString() : new Date().toISOString(),
    storyKey: str(form, "storyKey") || null,
  });
  bumpDataVersion(db);
  refreshAll();
  return { ok: "Parere registrato." };
}

export async function deleteEditorialAction(form: FormData) {
  const { user, db } = await requireContext();
  deleteEditorial(db, user.id, Number(form.get("id")));
  bumpDataVersion(db);
  refreshAll();
}

export async function setTeamNotesAction(form: FormData) {
  const { db } = await requireContext();
  setTeamNotes(db, Number(form.get("teamId")), str(form, "notes"), str(form, "source"));
  refreshAll();
}

// ---------------- Formazione ----------------

export async function saveLineupAction(form: FormData) {
  const { user, db } = await requireContext();
  const matchday = Number(form.get("matchday"));
  const starters = JSON.parse(str(form, "starters") || "[]") as number[];
  const bench = JSON.parse(str(form, "bench") || "[]") as number[];
  saveLineup(db, user.id, matchday, {
    module: str(form, "module"),
    starters,
    bench,
    strategy: str(form, "strategy") || null,
    recommendationId: numOrNull(form, "recommendationId"),
    expectedPoints: numOrNull(form, "expectedPoints"),
  });
  refreshAll();
  redirect(`/formazione?g=${matchday}&strategia=${str(form, "strategy") || "equilibrata"}&salvata=1`);
}

// ---------------- Impostazioni ----------------

export async function saveSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  const { user, db } = await requireContext();
  const n = (k: string, d = 0) => numOrNull(form, k) ?? d;
  const mode = str(form, "mode") === "mantra" ? "mantra" : "classic";
  let moduli: LeagueConfig["formazione"]["moduli"];
  if (mode === "classic") {
    const chosen = CLASSIC_MODULES.filter((m) => form.get(`modulo_${m}`) === "on");
    moduli = (chosen.length ? chosen : CLASSIC_MODULES).map(classicModule);
  } else {
    // formato: una riga per modulo, "3-4-3: Por | Dc | Dc | Dc | E | M;C | ..."
    const text = str(form, "mantraModules");
    const parsed = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [name, rest] = l.split(":");
        return { name: name.trim(), slots: (rest ?? "").split("|").map((s) => s.split(/[;,/]/).map((x) => x.trim()).filter(Boolean)).filter((s) => s.length) };
      })
      .filter((m) => m.name && m.slots.length >= 11);
    moduli = parsed.length ? parsed : MANTRA_MODULES_PROVVISORI;
  }
  const soglie = [1, 2, 3]
    .map((i) => ({ daMedia: numOrNull(form, `md_soglia_${i}`), bonus: numOrNull(form, `md_bonus_${i}`) }))
    .filter((s): s is { daMedia: number; bonus: number } => s.daMedia != null && s.bonus != null);
  const cfg = {
    mode,
    nomeLega: str(form, "nomeLega").slice(0, 80),
    bonus: {
      gol: { P: n("gol_P", 3), D: n("gol_D", 3), C: n("gol_C", 3), A: n("gol_A", 3) },
      assist: n("assist", 1),
      rigoreSegnato: n("rigoreSegnato", 3),
      rigoreParato: n("rigoreParato", 3),
      portaInviolata: n("portaInviolata", 1),
      golDecisivo: 0,
    },
    malus: {
      golSubito: n("golSubito", 1),
      ammonizione: n("ammonizione", 0.5),
      espulsione: n("espulsione", 1),
      autogol: n("autogol", 2),
      rigoreSbagliato: n("rigoreSbagliato", 3),
    },
    modificatoreDifesa: { attivo: form.get("modDifesa") === "on", minDifensori: n("minDifensori", 4), soglie },
    golSquadra: { soglia: n("soglia", 66), passo: n("passo", 6) },
    formazione: {
      moduli,
      panchina: Math.round(n("panchina", 7)),
      maxSostituzioni: Math.round(n("maxSostituzioni", 3)),
      regolaSostituzioni: str(form, "regolaSostituzioni") === "panchina_libera" ? "panchina_libera" : "ruolo_per_ruolo",
      senzaVoto: str(form, "senzaVoto") === "voto_ufficio" ? "voto_ufficio" : "zero",
      votoUfficio: n("votoUfficio", 0),
    },
    rosa: { P: Math.round(n("rosa_P", 3)), D: Math.round(n("rosa_D", 8)), C: Math.round(n("rosa_C", 8)), A: Math.round(n("rosa_A", 6)) },
    regoleSpecifiche: str(form, "regoleSpecifiche").slice(0, 2000),
  };
  const parsed = leagueConfigSchema.safeParse(cfg);
  if (!parsed.success) return { error: `Impostazioni non valide: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}` };
  saveLeagueSettings(db, user.id, parsed.data, form.get("confirmed") === "on");
  bumpDataVersion(db);
  refreshAll();
  return { ok: "Regolamento salvato. Le proiezioni ora seguono queste impostazioni." };
}

export async function toggleConnectorAction(form: FormData) {
  await requireContext();
  setConnectorEnabled(getDb("reale"), str(form, "id"), form.get("enabled") === "1");
  refreshAll();
}
