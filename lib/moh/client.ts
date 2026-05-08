// Israel MoH practitioners registry — CKAN client (plan §13).
//
// Endpoints:
//   GET {base}/action/datastore_search?resource_id=...&limit=...&offset=...
//   GET {base}/action/datastore_search_sql?sql=SELECT ...
//
// All requests are GETs; CKAN returns { success, result }.

const DEFAULT_BASE = "https://data.gov.il/api/3";
const DEFAULT_RESOURCE_ID = "9c64c522-bbc2-48fe-96fb-3b2a8626f59e";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;

export interface MohRecord {
  _id: number;
  "שם פרטי": string;
  "שם משפחה": string;
  "מספר רישיון רופא": number;
  "תאריך רישום רישיון"?: number | null;
  "מספר תעודת התמחות"?: number | null;
  "תאריך רישום התמחות"?: number | null;
  "שם התמחות"?: string | null;
}

export interface MohSearchPage {
  records: MohRecord[];
  total: number;
}

export interface MohClientOptions {
  base?: string;
  resourceId?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export class MohClient {
  private readonly base: string;
  private readonly resourceId: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetch: typeof fetch;

  constructor(options: MohClientOptions = {}) {
    this.base = (options.base ?? process.env.MOH_API_BASE ?? DEFAULT_BASE).replace(
      /\/$/,
      "",
    );
    this.resourceId =
      options.resourceId ?? process.env.MOH_RESOURCE_ID ?? DEFAULT_RESOURCE_ID;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.fetch = options.fetchImpl ?? fetch;
  }

  /**
   * Single page of practitioner records via `datastore_search`.
   * Pass `q` for substring search across all string fields, `offset/limit`
   * for paging.
   */
  async searchPage(
    options: { q?: string; limit?: number; offset?: number } = {},
  ): Promise<MohSearchPage> {
    const params = new URLSearchParams({ resource_id: this.resourceId });
    if (options.q) params.set("q", options.q);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined)
      params.set("offset", String(options.offset));

    const url = `${this.base}/action/datastore_search?${params}`;
    const json = await this.requestJSON<{
      success: boolean;
      result: { records: MohRecord[]; total: number };
    }>(url);
    if (!json.success) {
      throw new Error("CKAN response success=false");
    }
    return { records: json.result.records, total: json.result.total };
  }

  /**
   * Direct license-number lookup. Returns null if not present.
   * Used as the live fallback in the signup license-check route when the
   * local `moh_practitioners` mirror doesn't have the row.
   *
   * Implementation note: data.gov.il's `datastore_search_sql` rejects
   * queries with Hebrew column identifiers (403 Security Violation), so we
   * use `datastore_search` with the `filters` parameter instead.
   */
  async findByLicense(licenseNumber: number): Promise<MohRecord | null> {
    if (!Number.isInteger(licenseNumber) || licenseNumber <= 0) return null;
    const filters = JSON.stringify({ "מספר רישיון רופא": licenseNumber });
    const params = new URLSearchParams({
      resource_id: this.resourceId,
      limit: "1",
      filters,
    });
    const url = `${this.base}/action/datastore_search?${params}`;
    const json = await this.requestJSON<{
      success: boolean;
      result: { records: MohRecord[] };
    }>(url);
    if (!json.success) return null;
    return json.result.records[0] ?? null;
  }

  /**
   * Iterate all records in pages of `pageSize`. Used by the daily sync cron.
   */
  async *iterateAll(
    pageSize = 1000,
  ): AsyncGenerator<MohRecord, void, unknown> {
    let offset = 0;
    for (;;) {
      const { records } = await this.searchPage({ limit: pageSize, offset });
      if (records.length === 0) return;
      for (const r of records) yield r;
      if (records.length < pageSize) return;
      offset += pageSize;
    }
  }

  private async requestJSON<T>(url: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetch(url, {
          method: "GET",
          signal: ctrl.signal,
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          throw new Error(`MoH HTTP ${res.status}`);
        }
        return (await res.json()) as T;
      } catch (e) {
        lastErr = e;
        if (attempt < this.retries) {
          await sleep(200 * Math.pow(2, attempt));
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("MoH request failed after retries");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
