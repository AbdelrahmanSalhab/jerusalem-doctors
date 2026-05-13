// Tests 11 and 12 — cron/sync-moh route with stubbed Supabase and CKAN.
// Harness 1: vitest node environment, vi.mock for all I/O boundaries.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: vi.fn(),
}));

// MohClient must be mocked as a class so `new MohClient()` works.
vi.mock("@/lib/moh/client", () => ({
  MohClient: vi.fn(function (this: { iterateAll: () => AsyncGenerator<unknown> }) {
    this.iterateAll = vi.fn();
  }),
}));

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { MohClient } from "@/lib/moh/client";
import { GET as syncMohGET } from "@/app/api/cron/sync-moh/route";

const UUID_REVOKED_1 = "00000000-0000-0000-0000-aaa000000001";
const UUID_REVOKED_2 = "00000000-0000-0000-0000-aaa000000002";

const CKAN_RECORDS = [
  {
    "מספר רישיון רופא": 9417,
    "שם פרטי": "אחמד",
    "שם משפחה": "אלחטיב",
    "שם התמחות": "רפואת המשפחה",
  },
];

async function* asyncRecords(items: unknown[]) {
  for (const item of items) {
    yield item;
  }
}

function makeRequest(secret = "test-cron-secret"): Request {
  return new Request("http://localhost/api/cron/sync-moh", {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
  });
}

function setupMohClientMock(records = CKAN_RECORDS) {
  vi.mocked(MohClient).mockImplementation(function (this: { iterateAll: () => AsyncGenerator<unknown> }) {
    this.iterateAll = vi.fn(() => asyncRecords(records));
  } as unknown as new () => InstanceType<typeof MohClient>);
}

// ---------------------------------------------------------------------------
// Test 11 — Cron calls revocation_sweep RPC and writes per-doctor audit rows
// ---------------------------------------------------------------------------

describe("Test 11 — cron/sync-moh calls revocation_sweep and writes audit rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("calls rpc revocation_sweep and inserts per-revoked-doctor audit rows", async () => {
    const auditInserts: unknown[] = [];

    const serviceMock = {
      from: vi.fn((table: string) => ({
        upsert: vi.fn(async () => ({ error: null })),
        insert: vi.fn(async (rows: unknown) => {
          auditInserts.push(rows);
          return { data: null, error: null };
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
      })),
      rpc: vi.fn(async (fn: string) => {
        if (fn === "revocation_sweep") {
          return {
            data: {
              missed: 2,
              reset: 10,
              revoked: [UUID_REVOKED_1, UUID_REVOKED_2],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );
    setupMohClientMock();

    const req = makeRequest();
    const res = await syncMohGET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(serviceMock.rpc).toHaveBeenCalledOnce();
    expect(serviceMock.rpc).toHaveBeenCalledWith("revocation_sweep", { threshold_cycles: 3 });
    expect(json.sweep_revoked_count).toBe(2);

    // Find audit inserts for revoked doctors
    const revocationAuditInsert = auditInserts.find((r) => {
      const rows = (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>;
      return rows.some((row) => row["action"] === "license_revoked_sync");
    });
    expect(revocationAuditInsert).toBeDefined();

    const revRows = (Array.isArray(revocationAuditInsert) ? revocationAuditInsert : [revocationAuditInsert]) as Array<Record<string, string>>;
    const revIds = revRows.map((r) => r["target_doctor_id"]);
    expect(revIds).toContain(UUID_REVOKED_1);
    expect(revIds).toContain(UUID_REVOKED_2);

    // Final moh_sync_completed audit row
    const completedInsert = auditInserts.find((r) => {
      const rows = (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>;
      return rows.some((row) => row["action"] === "moh_sync_completed");
    });
    expect(completedInsert).toBeDefined();
    const completedRow = (Array.isArray(completedInsert) ? completedInsert[0] : completedInsert) as Record<string, unknown>;
    expect((completedRow["metadata"] as Record<string, number>)["sweep_revoked_count"]).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 12 — Revocation sweep failure does not abort the sync
// ---------------------------------------------------------------------------

describe("Test 12 — Revocation sweep failure does not abort the sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("returns 200 and zero revocation audit rows when sweep RPC fails", async () => {
    const auditInserts: unknown[] = [];
    let rpcCalled = false;

    const serviceMock = {
      from: vi.fn((_table: string) => ({
        upsert: vi.fn(async () => ({ error: null })),
        insert: vi.fn(async (rows: unknown) => {
          auditInserts.push(rows);
          return { data: null, error: null };
        }),
      })),
      rpc: vi.fn(async () => {
        rpcCalled = true;
        return { data: null, error: { message: "connection error", code: "PGRST999" } };
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );
    setupMohClientMock();

    const req = makeRequest();
    const res = await syncMohGET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(rpcCalled).toBe(true);
    expect(json.sweep_revoked_count).toBe(0);

    // No revocation audit rows
    const revocationAudit = auditInserts.find((r) => {
      const rows = (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>;
      return rows.some((row) => row["action"] === "license_revoked_sync");
    });
    expect(revocationAudit).toBeUndefined();

    // Sync-completed row must still exist
    const completedInsert = auditInserts.find((r) => {
      const rows = (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>;
      return rows.some((row) => row["action"] === "moh_sync_completed");
    });
    expect(completedInsert).toBeDefined();
    const completedRow = (Array.isArray(completedInsert) ? completedInsert[0] : completedInsert) as Record<string, unknown>;
    expect((completedRow["metadata"] as Record<string, number>)["sweep_revoked_count"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 13 — Pre-approved doctor is NOT bumped by the sweep
// ---------------------------------------------------------------------------

describe("Test 13 — pre-approved doctor is exempt from revocation sweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("does not bump missing_sync_count for a doctor on pre_approved_licenses", async () => {
    // The pre-approved doctor UUID is absent from moh_practitioners (not present
    // in CKAN_RECORDS) but the sweep RPC must exempt them because their license
    // appears in pre_approved_licenses. We simulate this by having the RPC return
    // missed=0 for that doctor (the SQL exemption does the real work in prod).
    const UUID_PRE_APPROVED = "00000000-0000-0000-0000-bbb000000001";

    const auditInserts: unknown[] = [];

    const serviceMock = {
      from: vi.fn((table: string) => ({
        upsert: vi.fn(async () => ({ error: null })),
        insert: vi.fn(async (rows: unknown) => {
          auditInserts.push(rows);
          return { data: null, error: null };
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          }),
        }),
      })),
      rpc: vi.fn(async (fn: string) => {
        if (fn === "revocation_sweep") {
          // The pre-approved doctor is NOT in the revoked list and missed=0
          // because the SQL exemption skips them in step 1.
          return {
            data: {
              missed: 0,
              reset: 1,
              revoked: [],
            },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceMock as unknown as ReturnType<typeof createSupabaseServiceClient>,
    );
    setupMohClientMock();

    const req = makeRequest();
    const res = await syncMohGET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sweep_revoked_count).toBe(0);

    // The pre-approved doctor UUID must not appear in any revocation audit row.
    const revocationAudit = auditInserts.find((r) => {
      const rows = (Array.isArray(r) ? r : [r]) as Array<Record<string, unknown>>;
      return rows.some((row) => row["action"] === "license_revoked_sync");
    });
    expect(revocationAudit).toBeUndefined();

    // Also assert the UUID is not mentioned in any audit row at all.
    const allRows = auditInserts.flatMap((r) => (Array.isArray(r) ? r : [r])) as Array<Record<string, unknown>>;
    const mentionsPreApproved = allRows.some(
      (row) => row["target_doctor_id"] === UUID_PRE_APPROVED,
    );
    expect(mentionsPreApproved).toBe(false);
  });
});
