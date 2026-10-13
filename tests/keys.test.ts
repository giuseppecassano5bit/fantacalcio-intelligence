import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// Le chiavi stanno nel database "reale": qui ne usiamo uno temporaneo.
beforeAll(() => {
  process.env.DATABASE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fi-keys-")), "keys.sqlite");
});
afterEach(() => {
  delete process.env.FOOTBALL_DATA_API_KEY;
});

describe("chiavi delle fonti", () => {
  it("usa la chiave salvata nell'app quando manca la variabile d'ambiente", async () => {
    const { apiKey, apiKeySource, saveApiKey } = await import("@/lib/connectors/keys");
    expect(apiKey("FOOTBALL_DATA_API_KEY")).toBe("");
    expect(apiKeySource("FOOTBALL_DATA_API_KEY")).toBeNull();
    saveApiKey("FOOTBALL_DATA_API_KEY", " 0123456789abcdef0123456789abcdef ");
    expect(apiKey("FOOTBALL_DATA_API_KEY")).toBe("0123456789abcdef0123456789abcdef");
    expect(apiKeySource("FOOTBALL_DATA_API_KEY")).toBe("app");
    saveApiKey("FOOTBALL_DATA_API_KEY", null);
    expect(apiKeySource("FOOTBALL_DATA_API_KEY")).toBeNull();
  });

  it("la variabile d'ambiente ha la precedenza", async () => {
    const { apiKey, apiKeySource, saveApiKey } = await import("@/lib/connectors/keys");
    saveApiKey("FOOTBALL_DATA_API_KEY", "chiave-salvata-nell-app-0000");
    process.env.FOOTBALL_DATA_API_KEY = "chiave-dal-server-1111";
    expect(apiKey("FOOTBALL_DATA_API_KEY")).toBe("chiave-dal-server-1111");
    expect(apiKeySource("FOOTBALL_DATA_API_KEY")).toBe("ambiente");
  });

  it("valida il formato e mostra solo le ultime cifre", async () => {
    const { validApiKey, maskApiKey } = await import("@/lib/connectors/keys");
    expect(validApiKey("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(validApiKey("corta")).toBe(false);
    expect(validApiKey("con spazi dentro 0123456789")).toBe(false);
    expect(maskApiKey("0123456789abcdef0123456789abcdef")).toBe("••••cdef");
  });
});
