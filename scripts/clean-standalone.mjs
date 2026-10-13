// Rimuove eventuali database locali copiati nel pacchetto standalone dal tracciamento dei file.
import fs from "node:fs";
import path from "node:path";

const dist = process.env.NEXT_DIST_DIR || ".next";
const target = path.join(dist, "standalone", "data");
if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`[postbuild] rimossa ${target}: i database non fanno parte del pacchetto`);
}
