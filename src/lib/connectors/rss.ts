import { XMLParser } from "fast-xml-parser";
import type { Connector, ConnectorOutcome, SyncContext } from "./types";
import { cachedGet } from "./http";
import { addAvailability, addNewsMention, upsertNews } from "@/lib/repo/data";
import { getPlayers, rosterPlayerIdsAllUsers } from "@/lib/repo/players";
import { normalizeName, teamKey } from "@/lib/domain/text";

interface Feed {
  name: string;
  url: string;
}

/** Feed configurati: SOS Fanta (verificato) + eventuali feed aggiuntivi da EXTRA_RSS_FEEDS ("Nome|url;Nome2|url2"). */
export function configuredFeeds(): Feed[] {
  const feeds: Feed[] = [{ name: "SOS Fanta", url: "https://www.sosfanta.com/feed" }];
  for (const part of (process.env.EXTRA_RSS_FEEDS ?? "").split(";")) {
    const [name, url] = part.split("|").map((s) => s?.trim());
    if (name && url && /^https?:\/\//.test(url)) feeds.push({ name, url });
  }
  if (process.env.DISABLE_SOSFANTA_RSS === "true") feeds.shift();
  return feeds;
}

const parser = new XMLParser({ ignoreAttributes: false, cdataPropName: false, textNodeName: "#text" });

export interface FeedItem {
  guid: string;
  title: string;
  link: string | null;
  pubDate: string | null;
  categories: string[];
  description: string;
}

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
};

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const items = doc?.rss?.channel?.item ?? doc?.feed?.entry ?? [];
  const arr = Array.isArray(items) ? items : [items];
  return arr
    .map((it: Record<string, unknown>) => {
      const cats = it.category == null ? [] : Array.isArray(it.category) ? it.category.map(text) : [text(it.category)];
      const link = typeof it.link === "string" ? it.link : text((it.link as Record<string, unknown>)?.["@_href"] ?? it.link);
      const desc = text(it.description ?? it.summary).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").trim();
      const date = text(it.pubDate ?? it.published ?? it.updated);
      return {
        guid: text(it.guid) || link || text(it.title),
        title: text(it.title).trim(),
        link: link || null,
        pubDate: date ? new Date(date).toISOString() : null,
        categories: cats.filter(Boolean),
        description: desc.slice(0, 280),
      };
    })
    .filter((i: FeedItem) => i.title);
}

/** Cerca menzioni di giocatori in una notizia: nome completo (alta) o cognome + squadra citata (media). */
export function findMentions(item: FeedItem, players: { id: number; full_name: string; team_key: string | null }[]) {
  const hay = ` ${normalizeName(`${item.title} ${item.description}`)} `;
  const teamTexts = new Set([...item.categories.map((c) => teamKey(c)), ...normalizeName(item.title).split(" ")]);
  const found: { playerId: number; confidence: "alta" | "media" }[] = [];
  for (const p of players) {
    const full = normalizeName(p.full_name);
    if (full.includes(" ") && hay.includes(` ${full} `)) {
      found.push({ playerId: p.id, confidence: "alta" });
      continue;
    }
    const tokens = full.split(" ");
    const surname = tokens[tokens.length - 1];
    if (surname.length >= 4 && hay.includes(` ${surname} `) && p.team_key && (teamTexts.has(p.team_key) || hay.includes(` ${p.team_key} `))) {
      found.push({ playerId: p.id, confidence: "media" });
    }
  }
  return found;
}

export const rssNews: Connector = {
  id: "rss",
  name: "Notizie RSS (SOS Fanta e feed aggiuntivi)",
  description: "Titoli e link delle ultime notizie fantacalcistiche. Le notizie che citano un giocatore della tua rosa vengono collegate alla sua scheda; quelle su infortuni diventano indiscrezioni da verificare.",
  provides: ["notizie"],
  requiresKey: false,
  docsUrl: "https://www.sosfanta.com/feed",
  limits: "Solo titolo, breve estratto e link forniti dal feed pubblico; nessun accesso agli articoli completi.",
  license: "Feed RSS pubblico: i contenuti restano dell'editore, mostrati con link alla fonte.",
  fallback: "Se il feed non risponde le notizie già scaricate restano visibili; i pareri si possono inserire a mano.",
  priority: 0,
  isConfigured: () => configuredFeeds().length > 0,

  async test(db) {
    const msgs: string[] = [];
    let ok = true;
    for (const f of configuredFeeds()) {
      try {
        const { body } = await cachedGet(db, f.url, { bucket: "rss", perMinute: 10, ttlSeconds: 60, force: true });
        msgs.push(`${f.name}: ${parseFeed(body).length} notizie`);
      } catch (e) {
        ok = false;
        msgs.push(`${f.name}: errore ${(e as Error).message}`);
      }
    }
    return { ok, message: msgs.join(" · ") };
  },

  async sync(ctx: SyncContext): Promise<ConnectorOutcome> {
    const out: ConnectorOutcome = { connector: "rss", ok: true, items: {}, messages: [] };
    const players = getPlayers(ctx.db, rosterPlayerIdsAllUsers(ctx.db)).map((p) => ({ id: p.id, full_name: p.full_name, team_key: p.team_key }));
    let created = 0;
    let mentions = 0;
    let rumors = 0;
    for (const f of configuredFeeds()) {
      try {
        const { body } = await cachedGet(ctx.db, f.url, { bucket: "rss", perMinute: 10, ttlSeconds: 30 * 60, force: ctx.force });
        for (const item of parseFeed(body)) {
          const r = upsertNews(ctx.db, {
            source: f.name,
            guid: item.guid,
            title: item.title,
            url: item.link,
            published_at: item.pubDate,
            categories: item.categories.join(", "),
            summary: item.description,
          });
          if (r.created) created++;
          const isInjury = item.categories.some((c) => /infortun|indisponibil|squalific/i.test(c)) || /infortun|lesione|stop|ko\b|out\b/i.test(item.title);
          for (const m of findMentions(item, players)) {
            addNewsMention(ctx.db, r.id, m.playerId, m.confidence);
            mentions++;
            if (r.created && isInjury) {
              addAvailability(ctx.db, {
                playerId: m.playerId,
                kind: /squalific/i.test(item.title) ? "squalifica" : "infortunio",
                certainty: "indiscrezione",
                description: item.title,
                source: `${f.name} (RSS)`,
                url: item.link,
                reportedAt: item.pubDate ?? new Date().toISOString(),
                origin: "rss",
              });
              rumors++;
            }
          }
        }
      } catch (e) {
        out.ok = false;
        out.messages.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    out.items = { nuove_notizie: created, menzioni: mentions, indiscrezioni: rumors };
    return out;
  },
};
