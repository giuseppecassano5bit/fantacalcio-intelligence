/** Lettura di file tabellari (CSV/TSV/XLSX) in una matrice di stringhe. */

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = { ";": (firstLine.match(/;/g) ?? []).length, ",": (firstLine.match(/,/g) ?? []).length, "\t": (firstLine.match(/\t/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ",") as string;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

export async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals: string[] = [];
    for (let c = 1; c <= r.cellCount; c++) {
      const cell = r.getCell(c);
      let t = "";
      const v = cell.value as unknown;
      if (v == null) t = "";
      else if (typeof v === "object" && v !== null && "result" in (v as Record<string, unknown>)) t = String((v as { result: unknown }).result ?? "");
      else if (typeof v === "object" && v !== null && "richText" in (v as Record<string, unknown>)) t = ((v as { richText: { text: string }[] }).richText ?? []).map((x) => x.text).join("");
      else if (v instanceof Date) t = v.toISOString().slice(0, 10);
      else t = String(v);
      vals.push(t.trim());
    }
    if (vals.some((x) => x !== "")) rows.push(vals);
  });
  return rows;
}

export async function readTable(fileName: string, buf: ArrayBuffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return parseXlsx(buf);
  if (lower.endsWith(".xls")) throw new Error("Il vecchio formato .xls non è supportato: salva il file come .xlsx o .csv.");
  return parseCsv(new TextDecoder("utf-8").decode(buf));
}

/** Numero da stringa italiana ("6,5", "6.5", "-", "6*"). */
export function num(v: string | undefined | null): number | null {
  if (v == null) return null;
  const s = String(v).replace("*", "").replace(",", ".").trim();
  if (s === "" || s === "-" || s.toLowerCase() === "sv" || s.toLowerCase() === "s.v.") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function int(v: string | undefined | null): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
