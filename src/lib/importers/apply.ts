import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { bumpDataVersion, nowIso, one, run, tx } from "@/lib/db";
import { SEASON_CODE, findMatchForTeam, upsertTeam, upsertTeamAdvanced, findTeamByName } from "@/lib/repo/league";
import { addToRoster, getPlayer, matchPlayerName, upsertPlayer } from "@/lib/repo/players";
import { addAvailability, addEditorial, upsertLineupReport, upsertMatchStats, upsertSeasonStats, type AvailabilityKind, type Certainty, type LineupStatus, type Verdict } from "@/lib/repo/data";
import { fantavote } from "@/lib/domain/fantavote";
import { DEFAULT_CONFIG, type RoleClassic } from "@/lib/domain/settings";
import { normalizeName, teamKey } from "@/lib/domain/text";
import { findHeader, type ImportKind } from "./formats";
import { int, num } from "./parse";

export interface PreviewRow {
  line: number;
  name: string;
  team: string | null;
  role: string | null;
  status: "riconosciuto" | "ambiguo" | "non_trovato" | "errore" | "nuovo";
  playerId: number | null;
  matchedName?: string;
  matchedTeam?: string | null;
  candidates: { id: number; name: string; team: string | null; role: string | null; score: number }[];
  message?: string;
  data: Record<string, string>;
}

export interface ImportPreview {
  batchId: string;
  kind: ImportKind;
  fileName: string;
  rows: PreviewRow[];
  summary: { total: number; riconosciuti: number; ambigui: number; nonTrovati: number; errori: number; nuovi: number };
  notes: string[];
  matchday?: number | null;
  season?: string;
}

const ROLE_SET = new Set(["P", "D", "C", "A"]);

function toRole(v: string | undefined | null): RoleClassic | null {
  const r = (v ?? "").trim().toUpperCase().slice(0, 1);
  if (ROLE_SET.has(r)) return r as RoleClassic;
  const n = normalizeName(v ?? "");
  if (n.startsWith("port")) return "P";
  if (n.startsWith("dif")) return "D";
  if (n.startsWith("cen")) return "C";
  if (n.startsWith("att")) return "A";
  return null;
}

/** Interpreta il file e prepara l'anteprima (senza scrivere dati di campionato). */
export function buildPreview(db: Db, userId: number, kind: ImportKind, fileName: string, rows: string[][], opts: { matchday?: number | null; season?: string } = {}): ImportPreview {
  const notes: string[] = [];
  const out: PreviewRow[] = [];
  const season = opts.season ?? SEASON_CODE;
  let matchday = opts.matchday ?? null;

  if (kind === "squadre_avanzate") {
    const h = findHeader(rows, ["squadra"]);
    if (!h) throw new Error("Intestazione non trovata: serve almeno la colonna 'squadra'.");
    for (let i = h.index + 1; i < rows.length; i++) {
      const r = rows[i];
      const team = r[h.map.squadra] ?? "";
      if (!team) continue;
      const t = findTeamByName(db, team, season);
      const data = Object.fromEntries(Object.entries(h.map).map(([k, idx]) => [k, r[idx] ?? ""]));
      out.push({ line: i + 1, name: team, team, role: null, status: t ? "riconosciuto" : "non_trovato", playerId: null, candidates: [], data, message: t ? undefined : "Squadra non presente nel calendario della stagione" });
    }
  } else if (kind === "voti") {
    // formato Fantacalcio.it: blocchi per squadra (riga col nome squadra, poi intestazione Cod./Ruolo/Nome/Voto...)
    if (!matchday) {
      const m = fileName.match(/giornata[_\s-]*(\d{1,2})/i);
      if (m) matchday = Number(m[1]);
    }
    if (!matchday) notes.push("Giornata non indicata: selezionala prima di confermare.");
    let currentTeam: string | null = null;
    let header: Record<string, number> | null = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const nonEmpty = r.filter((x) => x !== "");
      const h = findHeader([r], ["nome", "voto"]);
      if (h) {
        header = h.map;
        if ("squadra" in h.map) currentTeam = null;
        continue;
      }
      if (nonEmpty.length === 1 && isNaN(Number(nonEmpty[0])) && nonEmpty[0].length > 2) {
        currentTeam = nonEmpty[0];
        continue;
      }
      if (!header) continue;
      const name = r[header.nome] ?? "";
      const roleRaw = header.ruolo != null ? r[header.ruolo] : "";
      if (!name || (roleRaw && roleRaw.toUpperCase().startsWith("ALL"))) continue; // allenatori
      const team = header.squadra != null ? r[header.squadra] : currentTeam;
      const data = Object.fromEntries(Object.entries(header).map(([k, idx]) => [k, r[idx] ?? ""]));
      out.push(resolveRow(db, i + 1, name, team, toRole(roleRaw), data, header.id != null ? r[header.id] : null));
    }
    if (!header) throw new Error("Intestazione dei voti non trovata (servono almeno le colonne Nome e Voto).");
    notes.push("Il voto con asterisco (es. 6*) viene considerato senza voto.");
    notes.push("Gf include i rigori segnati: i gol su azione sono calcolati come Gf meno i rigori segnati.");
  } else {
    const h = findHeader(rows, ["nome"]);
    if (!h && kind === "rosa") {
      // elenco semplice di nomi (uno per riga o separati da virgola)
      const names = rows.flatMap((r) => r.join(",").split(/[,\n]/)).map((s) => s.trim()).filter(Boolean);
      names.forEach((n, i) => out.push(resolveRow(db, i + 1, n, null, null, { nome: n }, null)));
    } else if (!h) {
      throw new Error("Intestazione non trovata: serve almeno una colonna 'nome' (o 'giocatore').");
    } else {
      for (let i = h.index + 1; i < rows.length; i++) {
        const r = rows[i];
        const name = r[h.map.nome] ?? "";
        if (!name) continue;
        const team = h.map.squadra != null ? r[h.map.squadra] : null;
        const role = h.map.ruolo != null ? toRole(r[h.map.ruolo]) : null;
        const data = Object.fromEntries(Object.entries(h.map).map(([k, idx]) => [k, r[idx] ?? ""]));
        const row = resolveRow(db, i + 1, name, team, role, data, h.map.id != null ? r[h.map.id] : null);
        if (kind === "listone" && row.status !== "riconosciuto" && row.status !== "ambiguo") {
          row.status = role ? "nuovo" : "errore";
          row.message = role ? "Verrà aggiunto al catalogo" : "Ruolo mancante";
        }
        if ((kind === "probabili" || kind === "infortuni" || kind === "pareri") && row.status === "riconosciuto") {
          // controlli specifici
          if (kind === "probabili" && !["titolare", "ballottaggio", "panchina", "non_convocato", "indisponibile"].includes(normalizeName(data.stato ?? "").replace(" ", "_"))) {
            row.status = "errore";
            row.message = "Stato non valido (titolare, ballottaggio, panchina, non_convocato, indisponibile)";
          }
          if (kind === "pareri" && !["consigliato", "schierabile", "neutrale", "rischioso", "sconsigliato"].includes(normalizeName(data.giudizio ?? ""))) {
            row.status = "errore";
            row.message = "Giudizio non valido (consigliato, schierabile, neutrale, rischioso, sconsigliato)";
          }
          if ((kind === "probabili" || kind === "infortuni" || kind === "pareri") && !data.fonte) {
            row.status = "errore";
            row.message = "Fonte mancante: ogni informazione deve indicare la fonte";
          }
        }
        out.push(row);
      }
    }
    if (kind === "listone") notes.push("Il ruolo del listone (R) è il ruolo fantacalcistico ufficiale e ha precedenza su quello stimato dalla posizione reale.");
    if (kind === "statistiche") notes.push("Gf include i rigori segnati (R+). Se i minuti non sono presenti verranno stimati dalle presenze e segnalati come stima.");
  }

  const summary = {
    total: out.length,
    riconosciuti: out.filter((r) => r.status === "riconosciuto").length,
    ambigui: out.filter((r) => r.status === "ambiguo").length,
    nonTrovati: out.filter((r) => r.status === "non_trovato").length,
    errori: out.filter((r) => r.status === "errore").length,
    nuovi: out.filter((r) => r.status === "nuovo").length,
  };
  const batchId = randomUUID();
  const preview: ImportPreview = { batchId, kind, fileName, rows: out, summary, notes, matchday, season };
  run(db, "INSERT INTO import_batches (id, user_id, kind, file_name, created_at, status, payload) VALUES (?, ?, ?, ?, ?, 'anteprima', ?)", [
    batchId,
    userId,
    kind,
    fileName,
    nowIso(),
    JSON.stringify(preview),
  ]);
  return preview;
}

function resolveRow(db: Db, line: number, name: string, team: string | null | undefined, role: RoleClassic | null, data: Record<string, string>, fantaId: string | null | undefined): PreviewRow {
  if (fantaId) {
    const ext = one<{ player_id: number }>(db, "SELECT player_id FROM player_external_ids WHERE source = 'fantacalcio' AND external_id = ?", [String(fantaId)]);
    if (ext) {
      const p = getPlayer(db, ext.player_id)!;
      return { line, name, team: team ?? null, role, status: "riconosciuto", playerId: p.id, matchedName: p.full_name, matchedTeam: p.team_name, candidates: [], data };
    }
  }
  const m = matchPlayerName(db, name, team ?? null);
  const candidates = m.candidates.map((c) => ({ id: c.item.id, name: c.item.full_name, team: c.item.team_name, role: c.item.role_classic, score: c.score }));
  if (m.best) {
    const roleMismatch = role && m.best.role_classic && role !== m.best.role_classic;
    return {
      line, name, team: team ?? null, role,
      status: "riconosciuto",
      playerId: m.best.id,
      matchedName: m.best.full_name,
      matchedTeam: m.best.team_name,
      candidates,
      data,
      message: roleMismatch ? `Ruolo nel file (${role}) diverso da quello in catalogo (${m.best.role_classic})` : undefined,
    };
  }
  return { line, name, team: team ?? null, role, status: m.ambiguous && candidates.length ? "ambiguo" : "non_trovato", playerId: null, candidates, data, message: m.ambiguous ? "Più giocatori possibili: scegli quello corretto" : "Non trovato nel catalogo" };
}

export interface Resolution {
  line: number;
  action: "usa" | "crea" | "salta";
  playerId?: number | null;
  role?: RoleClassic | null;
  team?: string | null;
}

/** Applica un import dopo la conferma dell'utente (con le scelte per i casi ambigui). */
export function applyImport(db: Db, userId: number, batchId: string, resolutions: Resolution[], opts: { matchday?: number | null; season?: string; username: string }) {
  const batch = one<{ payload: string; status: string; user_id: number }>(db, "SELECT payload, status, user_id FROM import_batches WHERE id = ?", [batchId]);
  if (!batch || batch.user_id !== userId) throw new Error("Import non trovato");
  if (batch.status !== "anteprima") throw new Error("Import già applicato o annullato");
  const preview = JSON.parse(batch.payload) as ImportPreview;
  const season = opts.season ?? preview.season ?? SEASON_CODE;
  const matchday = opts.matchday ?? preview.matchday ?? null;
  const resBy = new Map(resolutions.map((r) => [r.line, r]));
  const result = { applicati: 0, creati: 0, saltati: 0, errori: [] as string[] };

  tx(db, () => {
    for (const row of preview.rows) {
      const r = resBy.get(row.line);
      let playerId: number | null = row.playerId;
      if (r?.action === "salta") {
        result.saltati++;
        continue;
      }
      if (r?.action === "usa" && r.playerId) playerId = r.playerId;
      if (preview.kind === "squadre_avanzate") {
        const t = findTeamByName(db, row.name, season);
        if (!t) {
          result.saltati++;
          continue;
        }
        upsertTeamAdvanced(db, t.id, {
          source: row.data.fonte || "import CSV",
          matches: int(row.data.partite),
          xgFor: num(row.data.xgFatti),
          xgAgainst: num(row.data.xgSubiti),
          shotsFor: int(row.data.tiriFatti),
          shotsAgainst: int(row.data.tiriSubiti),
          cleanSheets: int(row.data.porteInviolate),
        }, season);
        result.applicati++;
        continue;
      }
      const wantsCreate = r?.action === "crea" || (preview.kind === "listone" && row.status === "nuovo");
      if (!playerId && wantsCreate) {
        const role = r?.role ?? (row.role as RoleClassic | null);
        if (!role) {
          result.errori.push(`Riga ${row.line} (${row.name}): ruolo necessario per creare il giocatore`);
          continue;
        }
        const created = upsertPlayer(db, {
          fullName: row.name,
          team: r?.team ?? row.team,
          roleClassic: role,
          roleClassicSource: preview.kind === "listone" ? "listone" : "manuale",
          rolesMantra: row.data.ruoloMantra || null,
          source: preview.kind === "listone" ? "fantacalcio" : "manuale",
          externalId: preview.kind === "listone" && row.data.id ? row.data.id : null,
          origin: preview.kind === "listone" ? "import" : "manuale",
        });
        playerId = created.id;
        result.creati++;
      }
      if (!playerId) {
        if (row.status === "errore") result.errori.push(`Riga ${row.line} (${row.name}): ${row.message}`);
        else result.saltati++;
        continue;
      }
      try {
        applyRow(db, userId, preview.kind, row, playerId, { season, matchday, username: opts.username });
        result.applicati++;
      } catch (e) {
        result.errori.push(`Riga ${row.line} (${row.name}): ${(e as Error).message}`);
      }
    }
    run(db, "UPDATE import_batches SET status = 'applicato' WHERE id = ?", [batchId]);
    bumpDataVersion(db);
  });
  return result;
}

function applyRow(db: Db, userId: number, kind: ImportKind, row: PreviewRow, playerId: number, ctx: { season: string; matchday: number | null; username: string }) {
  const d = row.data;
  const player = getPlayer(db, playerId)!;
  switch (kind) {
    case "rosa":
      addToRoster(db, userId, playerId, { price: int(d.prezzo), notes: d.note || null });
      return;
    case "listone":
      upsertPlayer(db, {
        fullName: player.full_name,
        team: row.team,
        roleClassic: (row.role as RoleClassic) ?? null,
        roleClassicSource: "listone",
        rolesMantra: d.ruoloMantra || null,
        source: "fantacalcio",
        externalId: d.id || null,
        origin: "import",
      }, playerId);
      return;
    case "statistiche": {
      const rc = int(d.rc);
      const rPlus = int(d.rSegnati);
      const rMinus = int(d.rSbagliati);
      upsertSeasonStats(db, playerId, ctx.season, "fantacalcio.it (file statistiche)", {
        appearances: int(d.pv),
        starts: int(d.titolarita),
        minutes: int(d.minuti),
        avg_vote: num(d.mv),
        avg_fantavote: num(d.fm),
        goals: int(d.gf),
        goals_conceded: int(d.gs),
        assists: int(d.ass),
        penalties_taken: rc ?? (rPlus != null && rMinus != null ? rPlus + rMinus : null),
        penalties_scored: rPlus,
        penalties_missed: rMinus,
        penalties_saved: int(d.rp),
        yellow_cards: int(d.amm),
        red_cards: int(d.esp),
        own_goals: int(d.au),
        xg: num(d.xg),
        xa: num(d.xa),
        shots: int(d.tiri),
        shots_on_target: int(d.tiriPorta),
      });
      if (d.id) run(db, "INSERT OR IGNORE INTO player_external_ids (player_id, source, external_id) VALUES (?, 'fantacalcio', ?)", [playerId, d.id]);
      return;
    }
    case "voti": {
      if (!ctx.matchday) throw new Error("Giornata non indicata");
      const rawVote = d.voto ?? "";
      const vote = rawVote.includes("*") ? null : num(rawVote);
      const gf = int(d.gf) ?? 0;
      const pf = int(d.rSegnati) ?? 0;
      const line = {
        vote,
        goals: Math.max(0, gf - pf),
        penScored: pf,
        penMissed: int(d.rSbagliati) ?? 0,
        penSaved: int(d.rp) ?? 0,
        assists: int(d.ass) ?? 0,
        yellow: int(d.amm) ?? 0,
        red: int(d.esp) ?? 0,
        ownGoals: int(d.au) ?? 0,
        goalsConceded: int(d.gs) ?? 0,
      };
      const role = (player.role_classic ?? (row.role as RoleClassic) ?? "C") as RoleClassic;
      const teamId = player.current_team_id;
      const match = teamId ? findMatchForTeam(db, teamId, ctx.matchday, ctx.season) : undefined;
      upsertMatchStats(db, playerId, ctx.season, ctx.matchday, "fantacalcio.it (voti)", {
        match_id: match?.id ?? null,
        team_id: teamId,
        played: 1,
        vote,
        fantavote: num(d.fantavoto) ?? fantavote(line, role, DEFAULT_CONFIG),
        goals: line.goals,
        goals_conceded: line.goalsConceded,
        assists: line.assists,
        yellow: line.yellow,
        red: line.red,
        own_goals: line.ownGoals,
        pen_scored: line.penScored,
        pen_missed: line.penMissed,
        pen_saved: line.penSaved,
      });
      return;
    }
    case "probabili": {
      if (!player.current_team_id || !ctx.matchday) throw new Error("Squadra o giornata mancante");
      const match = findMatchForTeam(db, player.current_team_id, ctx.matchday, ctx.season);
      if (!match) throw new Error(`Nessuna partita per ${player.full_name} nella giornata ${ctx.matchday}`);
      const p = num(d.probabilita);
      upsertLineupReport(db, {
        matchId: match.id,
        playerId,
        source: d.fonte,
        kind: "probabile",
        status: normalizeName(d.stato).replace(" ", "_") as LineupStatus,
        probability: p == null ? null : p > 1 ? p / 100 : p,
        url: d.url || null,
        reportedAt: d.data ? new Date(d.data).toISOString() : nowIso(),
        origin: "manuale",
        createdBy: userId,
      });
      return;
    }
    case "infortuni": {
      const kindMap: Record<string, AvailabilityKind> = { infortunio: "infortunio", squalifica: "squalifica", diffida: "diffida", malattia: "malattia" };
      const certMap: Record<string, Certainty> = { confermato: "confermato", dubbio: "dubbio", in_recupero: "in_recupero", "in recupero": "in_recupero", indiscrezione: "indiscrezione" };
      addAvailability(db, {
        playerId,
        kind: kindMap[normalizeName(d.tipo)] ?? "altro",
        certainty: certMap[normalizeName(d.certezza)] ?? "dubbio",
        description: d.descrizione || null,
        expectedReturn: d.rientro || null,
        source: d.fonte,
        url: d.url || null,
        reportedAt: d.data ? new Date(d.data).toISOString() : nowIso(),
        origin: "manuale",
        createdBy: userId,
      });
      return;
    }
    case "pareri": {
      addEditorial(db, userId, {
        playerId,
        matchday: int(d.giornata) ?? ctx.matchday,
        source: d.fonte,
        verdict: normalizeName(d.giudizio) as Verdict,
        explicitAdvice: !["no", "n", "0", "false"].includes(normalizeName(d.esplicito ?? "si")),
        summary: d.sintesi || null,
        url: d.url || null,
        publishedAt: d.data ? new Date(d.data).toISOString() : null,
        storyKey: d.notizia || null,
      });
      return;
    }
    default:
      return;
  }
}

export function teamKeyOf(name: string) {
  return teamKey(name);
}
export { upsertTeam };
