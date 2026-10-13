import { describe, expect, it } from "vitest";
import { tempDb } from "./helpers";
import { run, one } from "@/lib/db";
import { teamKey, nameScore, matchName, normalizeName } from "@/lib/domain/text";
import { romeLocalToUtcIso } from "@/lib/domain/time";
import { parseCsv } from "@/lib/importers/parse";
import { findHeader, detectKind } from "@/lib/importers/formats";
import { buildPreview, applyImport } from "@/lib/importers/apply";
import { upsertMatch, listMatchesOfMatchday, currentMatchday } from "@/lib/repo/league";
import { upsertPlayer, addToRoster, removeFromRoster, getRoster, rosterHistory, getPlayer } from "@/lib/repo/players";
import { parseFeed, findMentions } from "@/lib/connectors/rss";
import { mapTsdbStatus } from "@/lib/connectors/thesportsdb";
import { positionToRole, mapFdStatus } from "@/lib/connectors/footballData";
import { hashPassword, verifyPassword, validatePasswordStrength } from "@/lib/auth/password";

function user(db: ReturnType<typeof tempDb>, name = "u") {
  return run(db, "INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', ?)", [name, new Date().toISOString()]).lastId;
}

describe("normalizzazione nomi e squadre", () => {
  it("riconosce le squadre con i nomi delle diverse fonti", () => {
    expect(teamKey("FC Internazionale Milano")).toBe("inter");
    expect(teamKey("Inter Milan")).toBe("inter");
    expect(teamKey("AC Milan")).toBe("milan");
    expect(teamKey("SSC Napoli")).toBe("napoli");
    expect(teamKey("Hellas Verona FC")).toBe("verona");
    expect(teamKey("Bologna FC 1909")).toBe(teamKey("Bologna"));
  });
  it("abbina nomi con iniziali, accenti e cognomi", () => {
    expect(nameScore("Martinez L.", "Lautaro Martínez")).toBeGreaterThanOrEqual(70);
    expect(nameScore("L. Martinez", "Lautaro Martinez")).toBeGreaterThanOrEqual(70);
    expect(normalizeName("Kvaratskhelia Khvicha")).toBe("kvaratskhelia khvicha");
  });
  it("segnala gli omonimi come ambigui", () => {
    const r = matchName("Thuram", [
      { id: 1, fullName: "Marcus Thuram", teamKey: "inter" },
      { id: 2, fullName: "Khéphren Thuram", teamKey: "juventus" },
    ]);
    expect(r.best).toBeNull();
    expect(r.ambiguous).toBe(true);
    const withTeam = matchName("Thuram", [
      { id: 1, fullName: "Marcus Thuram", teamKey: "inter" },
      { id: 2, fullName: "Khéphren Thuram", teamKey: "juventus" },
    ], { teamKey: "juventus" });
    expect(withTeam.best?.id).toBe(2);
  });
});

describe("orari", () => {
  it("converte l'ora italiana in UTC rispettando l'ora legale", () => {
    expect(romeLocalToUtcIso("2026-08-22", "18:30")).toBe("2026-08-22T16:30:00.000Z"); // CEST
    expect(romeLocalToUtcIso("2026-12-06", "20:45")).toBe("2026-12-06T19:45:00.000Z"); // CET
  });
});

describe("database: partite e precedenza delle fonti", () => {
  it("una fonte meno affidabile non sovrascrive ma registra la discrepanza", () => {
    const db = tempDb();
    upsertMatch(db, { matchday: 7, home: "Inter", away: "AC Milan", kickoffUtc: "2026-10-16T18:45:00.000Z", timeKnown: true, status: "programmata", homeGoals: null, awayGoals: null, source: "thesportsdb", priority: 20 });
    const r = upsertMatch(db, { matchday: 7, home: "FC Internazionale Milano", away: "Milan", kickoffUtc: "2026-10-17T18:45:00.000Z", timeKnown: true, status: "programmata", homeGoals: null, awayGoals: null, source: "openfootball", priority: 10 });
    expect(r.discrepancies).toHaveLength(1);
    const m = listMatchesOfMatchday(db, 7)[0];
    expect(m.kickoff_utc).toBe("2026-10-16T18:45:00.000Z");
    expect(m.source).toBe("thesportsdb");
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM data_discrepancies")!.n).toBe(1);
  });
  it("la giornata corrente è la prima non conclusa", () => {
    const db = tempDb();
    upsertMatch(db, { matchday: 1, home: "A", away: "B", kickoffUtc: "2026-08-22T16:30:00.000Z", timeKnown: true, status: "terminata", homeGoals: 1, awayGoals: 0, source: "t", priority: 1 });
    upsertMatch(db, { matchday: 2, home: "B", away: "A", kickoffUtc: "2099-08-29T16:30:00.000Z", timeKnown: true, status: "programmata", homeGoals: null, awayGoals: null, source: "t", priority: 1 });
    expect(currentMatchday(db)?.matchday).toBe(2);
  });
});

describe("rosa permanente", () => {
  it("un trasferimento reale non rimuove il giocatore dalla rosa e resta nello storico", () => {
    const db = tempDb();
    const u = user(db);
    const p = upsertPlayer(db, { fullName: "Mario Rossi", team: "Torino", roleClassic: "C", source: "football-data", externalId: 99, origin: "api" });
    addToRoster(db, u, p.id);
    const moved = upsertPlayer(db, { fullName: "Mario Rossi", team: "Genoa", roleClassic: "C", source: "football-data", externalId: 99, origin: "api" });
    expect(moved.id).toBe(p.id);
    expect(moved.transferred).toBe(true);
    expect(getRoster(db, u).map((r) => r.id)).toContain(p.id);
    expect(getPlayer(db, p.id)!.team_name).toBe("Genoa");
    expect(rosterHistory(db, u).some((h) => h.action === "trasferimento")).toBe(true);
  });
  it("la rimozione è logica: lo storico resta", () => {
    const db = tempDb();
    const u = user(db);
    const p = upsertPlayer(db, { fullName: "Luca Bianchi", team: "Lecce", roleClassic: "D", source: "manuale", origin: "manuale" });
    addToRoster(db, u, p.id);
    removeFromRoster(db, u, p.id);
    expect(getRoster(db, u)).toHaveLength(0);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM roster_entries WHERE player_id = ?", [p.id])!.n).toBe(1);
    expect(rosterHistory(db, u).map((h) => h.action)).toEqual(["rimosso", "aggiunto"]);
  });
  it("le rose di utenti diversi sono separate", () => {
    const db = tempDb();
    const a = user(db, "a");
    const b = user(db, "b");
    const p = upsertPlayer(db, { fullName: "Paolo Verdi", team: "Como", roleClassic: "A", source: "manuale", origin: "manuale" });
    addToRoster(db, a, p.id);
    expect(getRoster(db, a)).toHaveLength(1);
    expect(getRoster(db, b)).toHaveLength(0);
  });
  it("il ruolo del listone ha precedenza su quello stimato", () => {
    const db = tempDb();
    const p = upsertPlayer(db, { fullName: "Ala Destra", team: "Roma", roleClassic: "C", roleClassicSource: "listone", source: "fantacalcio", externalId: 5, origin: "import" });
    upsertPlayer(db, { fullName: "Ala Destra", team: "Roma", roleClassic: "A", roleClassicSource: "posizione reale (stimato)", source: "football-data", externalId: 77, origin: "api" }, p.id);
    expect(getPlayer(db, p.id)!.role_classic).toBe("C");
  });
});

describe("importazione file", () => {
  const listone = "Quotazioni Fantacalcio Stagione 2026 27\nId;R;RM;Nome;Squadra;Qt.A;Qt.I;Diff.\n101;P;Por;Portiere Uno;Inter;20;18;2\n102;A;Pc;Punta Due;Milan;30;25;5\n103;C;M;Mediano Tre;Inter;10;10;0\n";

  it("riconosce il listone e le sue colonne", () => {
    const rows = parseCsv(listone);
    expect(detectKind(rows, "Quotazioni_Fantacalcio.csv")).toBe("listone");
    const h = findHeader(rows)!;
    expect(h.index).toBe(1);
    expect(h.map).toMatchObject({ id: 0, ruolo: 1, ruoloMantra: 2, nome: 3, squadra: 4 });
  });

  it("anteprima e applicazione del listone popolano il catalogo", () => {
    const db = tempDb();
    const u = user(db);
    const prev = buildPreview(db, u, "listone", "listone.csv", parseCsv(listone));
    expect(prev.summary.nuovi).toBe(3);
    const res = applyImport(db, u, prev.batchId, [], { username: "u" });
    expect(res.creati).toBe(3);
    expect(one<{ n: number }>(db, "SELECT COUNT(*) n FROM players WHERE role_classic_source = 'listone'")!.n).toBe(3);
    // un import non può essere applicato due volte
    expect(() => applyImport(db, u, prev.batchId, [], { username: "u" })).toThrow();
  });

  it("le statistiche con R+ e R- vengono lette correttamente", () => {
    const db = tempDb();
    const u = user(db);
    const p = upsertPlayer(db, { fullName: "Punta Due", team: "Milan", roleClassic: "A", source: "fantacalcio", externalId: 102, origin: "import" });
    const csv = "Id;R;Rm;Nome;Squadra;Pv;Mv;Fm;Gf;Gs;Rp;Rc;R+;R-;Ass;Amm;Esp;Au\n102;A;Pc;Punta Due;Milan;6;6,5;8,25;5;0;0;2;2;0;1;1;0;0\n";
    const prev = buildPreview(db, u, "statistiche", "Statistiche.csv", parseCsv(csv));
    expect(prev.rows[0].status).toBe("riconosciuto");
    applyImport(db, u, prev.batchId, [{ line: prev.rows[0].line, action: "usa", playerId: p.id }], { username: "u" });
    const s = one<{ goals: number; penalties_scored: number; avg_vote: number; avg_fantavote: number; yellow_cards: number }>(db, "SELECT * FROM player_season_stats WHERE player_id = ?", [p.id])!;
    expect(s).toMatchObject({ goals: 5, penalties_scored: 2, avg_vote: 6.5, avg_fantavote: 8.25, yellow_cards: 1 });
  });

  it("i voti di giornata in blocchi per squadra: asterisco = senza voto", () => {
    const db = tempDb();
    const u = user(db);
    upsertPlayer(db, { fullName: "Portiere Uno", team: "Inter", roleClassic: "P", source: "fantacalcio", externalId: 101, origin: "import" });
    upsertPlayer(db, { fullName: "Mediano Tre", team: "Inter", roleClassic: "C", source: "fantacalcio", externalId: 103, origin: "import" });
    const csv = "INTER\nCod.;Ruolo;Nome;Voto;Gf;Gs;Rp;Rs;Rf;Au;Amm;Esp;Ass\n101;P;Portiere Uno;6,5;0;1;0;0;0;0;0;0;0\n103;C;Mediano Tre;6*;0;0;0;0;0;0;0;0;0\n999;ALL;Allenatore;6;0;0;0;0;0;0;0;0;0\n";
    const prev = buildPreview(db, u, "voti", "Voti_Fantacalcio_Stagione_2026_27_Giornata_6.csv", parseCsv(csv));
    expect(prev.matchday).toBe(6);
    expect(prev.rows).toHaveLength(2);
    applyImport(db, u, prev.batchId, [], { username: "u" });
    const rows = db.prepare("SELECT vote, fantavote, goals_conceded FROM player_match_stats ORDER BY player_id").all() as { vote: number | null; fantavote: number | null; goals_conceded: number }[];
    expect(rows[0]).toMatchObject({ vote: 6.5, fantavote: 5.5, goals_conceded: 1 });
    expect(rows[1].vote).toBeNull();
  });

  it("l'elenco incollato segnala i nomi non trovati", () => {
    const db = tempDb();
    const u = user(db);
    upsertPlayer(db, { fullName: "Nicolò Barella", team: "Inter", roleClassic: "C", source: "x", externalId: 1, origin: "api" });
    const prev = buildPreview(db, u, "rosa", "testo", [["nome"], ["Barella"], ["Sconosciuto Inventato"]]);
    expect(prev.rows.map((r) => r.status)).toEqual(["riconosciuto", "non_trovato"]);
  });
});

describe("connettori: parsing", () => {
  it("RSS: titoli, categorie e menzioni prudenti", () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item><guid>g1</guid><title><![CDATA[Bologna, esami per Orsolini: tempi di recupero]]></title><link>https://example.org/a</link><pubDate>Tue, 13 Oct 2026 10:00:34 +0200</pubDate><category><![CDATA[Bologna]]></category><category><![CDATA[Infortunati]]></category><description><![CDATA[<p>Testo</p>]]></description></item></channel></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(1);
    expect(items[0].categories).toContain("Infortunati");
    const found = findMentions(items[0], [
      { id: 1, full_name: "Riccardo Orsolini", team_key: "bologna" },
      { id: 2, full_name: "Mario Orsolini", team_key: "lecce" },
    ]);
    expect(found).toEqual([{ playerId: 1, confidence: "media" }]);
  });
  it("stati delle partite", () => {
    expect(mapTsdbStatus("FT", "no", true)).toBe("terminata");
    expect(mapTsdbStatus("NS", "no", false)).toBe("programmata");
    expect(mapTsdbStatus("Match Postponed", "yes", false)).toBe("rinviata");
    expect(mapFdStatus("TIMED")).toBe("programmata");
    expect(mapFdStatus("FINISHED")).toBe("terminata");
  });
  it("ruolo stimato dalla posizione reale", () => {
    expect(positionToRole("Goalkeeper")).toEqual({ role: "P", estimated: false });
    expect(positionToRole("Centre-Back").role).toBe("D");
    expect(positionToRole("Left Winger")).toEqual({ role: "A", estimated: true });
  });
});

describe("password", () => {
  it("hash e verifica", () => {
    const h = hashPassword("UnaPassword123");
    expect(verifyPassword("UnaPassword123", h)).toBe(true);
    expect(verifyPassword("sbagliata", h)).toBe(false);
    expect(validatePasswordStrength("corta")).not.toBeNull();
  });
});
