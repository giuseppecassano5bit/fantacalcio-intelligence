#!/usr/bin/env node
// Avvio con un comando di FantaIntelligence, uguale su Mac, Windows, Linux e GitHub Codespaces:
// installa le dipendenze, compila la versione di produzione solo quando il codice è cambiato,
// avvia il server, aspetta che risponda e apre il browser.
//
//   node scripts/avvia.mjs                 avvia (solo da questo computer)
//   node scripts/avvia.mjs --rete          raggiungibile anche dal telefono sulla stessa rete Wi-Fi
//   node scripts/avvia.mjs --porta 3100    porta diversa da 3000
//   node scripts/avvia.mjs --prepara       installa e compila senza avviare (usato da Codespaces)
//   node scripts/avvia.mjs --senza-browser non apre il browser

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = ".next-app"; // cartella di build separata da quella di `npm run dev`
const STANDALONE = path.join(ROOT, DIST, "standalone");
const STAMP = path.join(ROOT, DIST, "impronta-build.txt");
const MIN_NODE = [22, 13];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const inCodespaces = process.env.CODESPACES === "true";
const lan = flag("--rete");
const prepareOnly = flag("--prepara");

function say(msg = "") {
  console.log(msg ? `[FantaIntelligence] ${msg}` : "");
}
function fail(msg) {
  console.error(`\n[FantaIntelligence] ERRORE: ${msg}\n`);
  process.exit(1);
}

// ---------- Node ----------
const [maj, min] = process.versions.node.split(".").map(Number);
if (maj < MIN_NODE[0] || (maj === MIN_NODE[0] && min < MIN_NODE[1])) {
  fail(`serve Node.js ${MIN_NODE.join(".")} o successivo (trovato ${process.versions.node}). Scarica la versione LTS da https://nodejs.org/it/download e riprova.`);
}

// ---------- Configurazione (.env, .env.local) ----------
for (const f of [".env.local", ".env"]) {
  const p = path.join(ROOT, f);
  // loadEnvFile non sovrascrive le variabili già presenti: vince .env.local, poi .env
  if (fs.existsSync(p)) process.loadEnvFile(p);
}

// In Codespaces i comandi di avvio non ricevono sempre le variabili del codespace (nome, dominio delle
// porte, segreti personali): si leggono dal file che il codespace mette a disposizione.
if (inCodespaces) {
  try {
    const shared = JSON.parse(fs.readFileSync("/workspaces/.codespaces/shared/user-secrets-envs.json", "utf8"));
    for (const k of ["CODESPACE_NAME", "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN", "FOOTBALL_DATA_API_KEY", "API_FOOTBALL_KEY"]) {
      if (!process.env[k] && typeof shared[k] === "string" && shared[k]) process.env[k] = shared[k];
    }
  } catch {
    // file assente: restano le variabili già presenti
  }
}

// ---------- npm ----------
function npm(npmArgs, extraEnv = {}) {
  const cli = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), // Windows
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), // Mac/Linux
  ].find((p) => fs.existsSync(p));
  const env = { ...process.env, ...extraEnv };
  const r = cli
    ? spawnSync(process.execPath, [cli, ...npmArgs], { cwd: ROOT, stdio: "inherit", env })
    : spawnSync("npm", npmArgs, { cwd: ROOT, stdio: "inherit", env, shell: process.platform === "win32" });
  return r.status === 0;
}

function sha(content) {
  return createHash("sha256").update(content).digest("hex");
}

// ---------- 1. Dipendenze ----------
const lockHash = sha(fs.readFileSync(path.join(ROOT, "package-lock.json")));
const depsStamp = path.join(ROOT, "node_modules", ".impronta-dipendenze");
if (!fs.existsSync(depsStamp) || fs.readFileSync(depsStamp, "utf8") !== lockHash) {
  say("Installo le dipendenze (solo la prima volta o dopo un aggiornamento: 1-3 minuti)…");
  if (!npm(["ci", "--no-audit", "--no-fund"])) fail("installazione delle dipendenze non riuscita. Controlla la connessione a Internet e riprova.");
  fs.writeFileSync(depsStamp, lockHash);
}

// ---------- 2. Build di produzione (solo se il codice è cambiato) ----------
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function buildFingerprint() {
  const h = createHash("sha256");
  const files = [
    ...["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"].map((f) => path.join(ROOT, f)),
    ...listFiles(path.join(ROOT, "src")),
    ...listFiles(path.join(ROOT, "public")),
  ].filter((f) => fs.existsSync(f));
  for (const f of files.sort()) {
    h.update(path.relative(ROOT, f));
    h.update(fs.readFileSync(f));
  }
  // la configurazione di Codespaces entra nella build (domini ammessi per le Server Actions)
  h.update(`${process.env.CODESPACES ?? ""}|${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? ""}|${process.env.SERVER_ACTIONS_ALLOWED_ORIGINS ?? ""}`);
  return h.digest("hex");
}

const fingerprint = buildFingerprint();
const serverJs = path.join(STANDALONE, "server.js");
if (flag("--ricompila") || !fs.existsSync(serverJs) || !fs.existsSync(STAMP) || fs.readFileSync(STAMP, "utf8") !== fingerprint) {
  say("Preparo la versione ottimizzata dell'app (1-3 minuti)…");
  fs.rmSync(STANDALONE, { recursive: true, force: true, maxRetries: 5 });
  if (!npm(["run", "build"], { NEXT_DIST_DIR: DIST, NEXT_TELEMETRY_DISABLED: "1" })) fail("compilazione non riuscita: i dettagli sono qui sopra.");
  // il server standalone non contiene i file statici: vanno copiati accanto
  fs.cpSync(path.join(ROOT, DIST, "static"), path.join(STANDALONE, DIST, "static"), { recursive: true });
  if (fs.existsSync(path.join(ROOT, "public"))) fs.cpSync(path.join(ROOT, "public"), path.join(STANDALONE, "public"), { recursive: true });
  // impronta ricalcolata dopo la build: next build può aggiornare tsconfig.json
  fs.writeFileSync(STAMP, buildFingerprint());
}

if (prepareOnly) {
  say("Preparazione completata.");
  process.exit(0);
}

// ---------- 3. Avvio ----------
async function isOurServer(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    return j?.ok === true && "migrations" in j;
  } catch {
    return false;
  }
}

function answers(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.setTimeout(1000);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("timeout", () => (s.destroy(), resolve(false)));
    s.once("error", () => resolve(false));
  });
}

/** Libera se nessuno risponde su 127.0.0.1 e ::1 (anche "localhost" deve arrivare a noi) e se si riesce ad aprirla. */
async function portFree(port, host) {
  if ((await answers(port, "127.0.0.1")) || (await answers(port, "::1"))) return false;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => srv.close(() => resolve(true)));
  });
}

function publicUrl(port) {
  if (inCodespaces && process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  }
  return `http://localhost:${port}`;
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const p = spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true });
    p.on("error", () => {}); // nessun browser disponibile: l'indirizzo è comunque stampato
    p.unref();
  } catch {
    // come sopra
  }
}

function banner(url, port) {
  say();
  say("========================================================");
  say("  FantaIntelligence è pronta!");
  say(`  Apri: ${url}`);
  if (lan) for (const ip of lanAddresses()) say(`  Dal telefono (stessa rete Wi-Fi): http://${ip}:${port}`);
  if (inCodespaces) say("  Se la pagina non si apre da sola: scheda PORTE qui sotto, riga 3000, icona del globo.");
  say("  Per chiudere l'app premi Ctrl+C (o chiudi questa finestra).");
  say("========================================================");
  say();
}

const host = inCodespaces || lan ? "0.0.0.0" : "127.0.0.1";
let port = Number(option("--porta") ?? process.env.PORT ?? 3000);

if (await isOurServer(port)) {
  banner(publicUrl(port), port);
  say("L'app era già in esecuzione: non serve avviarla di nuovo.");
  process.exit(0);
}
if (!(await portFree(port, host))) {
  if (inCodespaces) fail(`la porta ${port} è occupata da un altro programma.`);
  const start = port;
  while (port < start + 20 && !(await portFree(port, host))) port++;
  if (!(await portFree(port, host))) fail(`le porte da ${start} a ${start + 19} sono tutte occupate. Usa --porta con un numero diverso.`);
  say(`La porta ${start} è occupata: uso la ${port}.`);
}

const dataDir = path.join(ROOT, "data");
const resolveData = (v, fallback) => (v ? path.resolve(ROOT, v) : path.join(dataDir, fallback));
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PORT: String(port),
  HOSTNAME: host,
  // il server standalone lavora nella propria cartella: i database restano in data/ del progetto
  DATABASE_PATH: resolveData(process.env.DATABASE_PATH, "fantacalcio.sqlite"),
  DEMO_DATABASE_PATH: resolveData(process.env.DEMO_DATABASE_PATH, "demo.sqlite"),
  // in locale si usa http: i cookie di sessione non possono essere "Secure" (Codespaces invece è in https)
  INSECURE_COOKIES: inCodespaces ? process.env.INSECURE_COOKIES ?? "false" : "true",
  // in Codespaces l'output nel terminale tiene acceso il codespace mentre si usa l'app
  LOG_REQUESTS: inCodespaces ? "true" : process.env.LOG_REQUESTS ?? "false",
};

say("Avvio del server…");
const child = spawn(process.execPath, [serverJs], { cwd: STANDALONE, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  if (await isOurServer(port)) break;
  await new Promise((r) => setTimeout(r, 500));
}
if (!(await isOurServer(port))) {
  child.kill();
  fail("il server non risponde. I dettagli sono qui sopra.");
}
const url = publicUrl(port);
banner(url, port);
if (!inCodespaces && !flag("--senza-browser") && !process.env.CI) openBrowser(url);
