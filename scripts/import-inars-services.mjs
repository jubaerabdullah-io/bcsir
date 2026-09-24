#!/usr/bin/env node
// Usage:
//   npm run data:services                      fetch the official INARS list
//   npm run data:services -- --from-file x.html  use a saved copy of the page
//
// Imports the "Service Charge list of Analytical Parameters" published by the
// Institute of National Analytical Research & Services (INARS), BCSIR, into
// public/data/directory/testing-services.json.
//
// Every record is copied from one table row of the official page: the test
// parameter, sample type, method, fee and duration are kept exactly as
// published (only whitespace is collapsed). Nothing is added or guessed. Each
// record keeps the page's serial number ("SI") so it can be checked against the
// source. Records of other laboratories in the file are kept unchanged.
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const INARS_SOURCE = {
  id: "inars-service-charges",
  title: "Service Charge list of Analytical Parameters",
  publisher: "Institute of National Analytical Research & Services (INARS), BCSIR",
  url: "https://inars.bcsir.gov.bd/pages/static-pages/6922df91933eb65569e22ced"
};
const EXPECTED_HEADER = ["SI", "Name of Sample", "Test Parameter", "Methodology", "Fees", "Duration"];
const TARGET = "public/data/directory/testing-services.json";

const decode = (html) => html
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, "")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

// Rows of every <table>, with rowspan/colspan expanded.
export function parseTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([table]) => {
    const pending = [];
    return [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(([row]) => {
      const cells = [...row.matchAll(/<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi)].map((match) => ({
        text: decode(match[3]),
        rowspan: Number(/rowspan="?(\d+)/i.exec(match[2])?.[1] || 1),
        colspan: Number(/colspan="?(\d+)/i.exec(match[2])?.[1] || 1)
      }));
      const line = [];
      let column = 0, next = 0;
      while (next < cells.length || pending[column]?.left > 0) {
        if (pending[column]?.left > 0) { line[column] = pending[column].text; pending[column].left -= 1; column += 1; continue; }
        const cell = cells[next++];
        for (let span = 0; span < cell.colspan; span += 1) {
          line[column] = cell.text;
          if (cell.rowspan > 1) pending[column] = { text: cell.text, left: cell.rowspan - 1 };
          column += 1;
        }
      }
      return line;
    });
  });
}

export function inarsRecords(html) {
  const rows = parseTables(html).flat();
  const header = rows.find((row) => row[0] === "SI");
  if (!header || EXPECTED_HEADER.some((name, index) => header[index] !== name)) {
    throw new Error(`The INARS table layout changed (header ${JSON.stringify(header)}). Nothing was written.`);
  }
  const records = rows.filter((row) => row !== header && row[0] !== "SI").map((row) => {
    if (row.length !== EXPECTED_HEADER.length || !/^\d+$/.test(row[0])) throw new Error(`Unexpected row ${JSON.stringify(row)}. Nothing was written.`);
    const [serial, sampleType, parameter, method, fee, duration] = row;
    const feeNumber = /^\d+(?:\.\d+)?$/.test(fee) ? Number(fee) : null;
    const days = /^\d+$/.test(duration) ? Number(duration) : null;
    return {
      id: `inars-${serial}`,
      name: parameter,
      sample_type: sampleType,
      method,
      fee_bdt: feeNumber,
      ...(feeNumber === null && fee ? { fee_text: fee } : {}),
      duration_days: days,
      ...(days === null && duration ? { duration_text: duration } : {}),
      laboratory_id: "inars",
      source: INARS_SOURCE.id,
      source_ref: `SI ${serial}`
    };
  });
  const ids = new Set(records.map((record) => record.id));
  if (ids.size !== records.length) throw new Error("Duplicate serial numbers in the INARS table. Nothing was written.");
  return records.sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)));
}

export function servicesFileText(file) {
  const line = (value) => `    ${JSON.stringify(value)}`;
  return [
    "{",
    `  "schema": ${JSON.stringify(file.schema)},`,
    `  "about": ${JSON.stringify(file.about)},`,
    `  "sources": [\n${file.sources.map(line).join(",\n")}\n  ],`,
    `  "services": [\n${file.services.map(line).join(",\n")}\n  ]`,
    "}",
    ""
  ].join("\n");
}

const ABOUT = "Laboratory testing services shown in the map search. laboratory_id links each record to laboratories.json; the map uses that laboratory's building unless the record sets its own building_id. Add only verified records and name their source.";

async function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const fileArg = process.argv.indexOf("--from-file");
  const html = fileArg > 0
    ? await readFile(process.argv[fileArg + 1], "utf8")
    : await (await fetch(INARS_SOURCE.url, { headers: { "User-Agent": "Mozilla/5.0 (BCSIR campus map data import)" } })).text();
  const records = inarsRecords(html);
  const target = path.join(root, TARGET);
  const existing = existsSync(target) ? JSON.parse(await readFile(target, "utf8")) : { sources: [], services: [] };
  const now = new Date();
  const retrieved = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
  const file = {
    schema: "bcsir-testing-services/1",
    about: ABOUT,
    sources: [...existing.sources.filter((source) => source.id !== INARS_SOURCE.id), { ...INARS_SOURCE, retrieved, records: records.length }],
    services: [...existing.services.filter((service) => service.source !== INARS_SOURCE.id), ...records]
  };
  await writeFile(target, servicesFileText(file), "utf8");
  console.log(`Wrote ${records.length} INARS testing services to ${TARGET} (retrieved ${retrieved}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
