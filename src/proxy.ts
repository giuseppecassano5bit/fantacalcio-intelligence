import { NextResponse, type NextRequest } from "next/server";

// Controllo ottimistico: senza cookie di sessione si va al login.
// La verifica vera della sessione avviene lato server in ogni pagina e API.
const PUBLIC = ["/login", "/setup", "/registrati", "/api/cron", "/api/health"];

// In GitHub Codespaces l'inattività si misura anche dall'output del terminale: una riga per ogni
// pagina aperta tiene acceso il codespace finché qualcuno usa l'app (LOG_REQUESTS=true).
const LOG = process.env.LOG_REQUESTS === "true";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (LOG && !pathname.startsWith("/api/health")) console.log(`[${new Date().toLocaleTimeString("it-IT")}] ${request.method} ${pathname}`);
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.cookies.get("fi_session")?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Accesso richiesto" }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
