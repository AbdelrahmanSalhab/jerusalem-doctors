// Stands in for data.gov.il's CKAN datastore_search (lib/moh/client.ts) so
// signup and the admin licence check never depend on a live government API.
// Serves e2e/registry.json; supports `filters` (licence lookup), `q`,
// `limit` and `offset`.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const REGISTRY = JSON.parse(readFileSync(new URL("./registry.json", import.meta.url), "utf8"));
const PORT = Number(process.env.MOH_STUB_PORT ?? 3124);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/health") return res.end("ok");
  if (url.pathname !== "/api/3/action/datastore_search") {
    res.statusCode = 404;
    return res.end();
  }
  let rows = REGISTRY;
  const filters = url.searchParams.get("filters");
  if (filters) {
    const f = JSON.parse(filters);
    rows = rows.filter((r) => Object.entries(f).every(([k, v]) => r[k] === v));
  }
  const q = url.searchParams.get("q");
  if (q) rows = rows.filter((r) => Object.values(r).some((v) => String(v).includes(q)));
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ success: true, result: { records: rows.slice(offset, offset + limit), total: rows.length } }));
}).listen(PORT, "127.0.0.1");
