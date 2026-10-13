import { describe, expect, it } from "vitest";
import { planSync, type PlannerState } from "@/lib/sync/planner";

const H = 3_600_000;
const now = Date.parse("2026-10-15T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const fresh: PlannerState = {
  lastLeggero: iso(now - H),
  lastCompleto: iso(now - 2 * H),
  lastRisultati: iso(now - H),
  lastFormazioni: iso(now - H),
  officialLineupsAvailable: true,
};

describe("pianificatore degli aggiornamenti", () => {
  it("senza calendario scarica subito il calendario", () => {
    expect(planSync([], fresh, now).action).toBe("leggero");
  });

  it("non fa nulla se la prossima partita è lontana e i dati sono freschi", () => {
    const d = planSync([{ kickoff: iso(now + 72 * H), status: "programmata" }], fresh, now);
    expect(d.action).toBeNull();
    // il prossimo controllo è il controllo leggero (12 ore dall'ultimo), prima della finestra delle 24 ore
    expect(d.nextCheckAt).toBe(iso(now + 11 * H));
    expect(Date.parse(d.nextCheckAt!)).toBeLessThanOrEqual(now + 48 * H);
  });

  it("entro 24 ore dalla partita esegue l'aggiornamento completo", () => {
    const d = planSync([{ kickoff: iso(now + 20 * H), status: "programmata" }], { ...fresh, lastCompleto: iso(now - 4 * H) }, now);
    expect(d.action).toBe("completo");
    expect(d.reason).toMatch(/24 ore/);
  });

  it("nelle ultime 3 ore aggiorna ogni 30 minuti", () => {
    const st = { ...fresh, lastCompleto: iso(now - 40 * 60_000) };
    expect(planSync([{ kickoff: iso(now + 2 * H), status: "programmata" }], st, now).action).toBe("completo");
    const recent = { ...fresh, lastCompleto: iso(now - 10 * 60_000) };
    expect(planSync([{ kickoff: iso(now + 2 * H), status: "programmata" }], recent, now).action).toBeNull();
  });

  it("vicino al calcio d'inizio cerca le formazioni ufficiali", () => {
    const st = { ...fresh, lastCompleto: iso(now - 10 * 60_000), lastFormazioni: iso(now - 20 * 60_000) };
    expect(planSync([{ kickoff: iso(now + 50 * 60_000), status: "programmata" }], st, now).action).toBe("formazioni");
  });

  it("dopo la fine delle partite acquisisce i risultati", () => {
    const d = planSync([{ kickoff: iso(now - 3 * H), status: "programmata" }], fresh, now);
    expect(d.action).toBe("risultati");
  });

  it("giornate con orari diversi: ogni partita apre la propria finestra", () => {
    // anticipo venerdì già giocato e registrato, posticipo lunedì tra 22 ore
    const d = planSync(
      [
        { kickoff: iso(now - 70 * H), status: "terminata" },
        { kickoff: iso(now + 22 * H), status: "programmata" },
      ],
      { ...fresh, lastCompleto: iso(now - 5 * H) },
      now,
    );
    expect(d.action).toBe("completo");
  });

  it("aggiornamento quotidiano anche lontano dalle partite", () => {
    const d = planSync([{ kickoff: iso(now + 100 * H), status: "programmata" }], { ...fresh, lastCompleto: iso(now - 25 * H) }, now);
    expect(d.action).toBe("completo");
  });
});
