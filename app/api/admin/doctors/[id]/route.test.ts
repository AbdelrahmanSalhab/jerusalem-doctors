import { beforeEach, describe, expect, it, vi } from "vitest";

const updates: Record<string, unknown>[] = [];
const audits: Record<string, unknown>[] = [];

/** The licence status the doctor being patched currently has. */
let licenseStatus: string | null = "verified";
let alreadyAccepted = false;
let accountOpen = true;
let doctorExists = true;
/** The doctor being patched is an admin (another admin acting on a peer). */
let targetIsAdmin = false;
/** Whether the conditional accept finds a row still waiting and open. */
let acceptLands = true;
/** What a second read of the row finds once the accept landed nowhere. */
let approvedMeanwhile = false;
let reads = 0;
/** The conditions the accept update carried. */
const updateEqs: string[] = [];
let readError: unknown = null;
let updateError: unknown = null;
/** Whether the log holds a primary licence correction for the doctor. */
let corrected = false;
let auditReadError: { code: string } | null = null;
/** What the route asked the log, to prove the question is the right one. */
const auditAsks: string[] = [];

const { requireAdminOrNull } = vi.hoisted(() => ({
  requireAdminOrNull: vi.fn(async (): Promise<{ id: string } | null> => ({ id: "00000000-0000-4000-8000-00000000a001" })),
}));
vi.mock("@/lib/auth/adminApi", () => ({ requireAdminOrNull }));
// The dashboard's cache is cleared after an update; there is no request
// scope for revalidateTag here.
const directoryChanged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/cachedReads", () => ({ directoryChanged }));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({
    from: (table: string) => ({
      // The route reads the current licence status before writing, to know
      // whether accepting this doctor needs a reason.
      select: () => {
        const chain: Record<string, unknown> = {
          maybeSingle: async () =>
            table === "audit_logs"
              ? { data: corrected ? { id: "a1" } : null, error: auditReadError }
              : { data: doctorExists ? { license_verification_status: licenseStatus, is_admin_approved: alreadyAccepted || (reads++ > 0 && approvedMeanwhile), is_active: accountOpen, is_admin: targetIsAdmin } : null, error: readError },
        };
        chain.eq = (col: string, v: unknown) => (table === "audit_logs" && auditAsks.push(`${col}=${String(v)}`), chain);
        chain.limit = () => chain;
        return chain;
      },
      update(values: Record<string, unknown>) {
        updates.push(values);
        const chain: Record<string, unknown> = {
          select: async () => ({ data: acceptLands ? [{ id: "d1" }] : [], error: updateError }),
        };
        chain.eq = (col: string, v: unknown) => (updateEqs.push(`${col}=${String(v)}`), chain);
        return chain;
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_logs") audits.push(row);
        return { error: null };
      },
    }),
  }),
}));

async function call(body: unknown, id = "00000000-0000-4000-8000-0000000000d1") {
  const { PATCH } = await import("./route");
  return PATCH(
    new Request("https://example.test/api/admin/doctors/d1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  targetIsAdmin = false;
  acceptLands = true;
  approvedMeanwhile = false;
  reads = 0;
  updateEqs.length = 0;
  corrected = false;
  alreadyAccepted = false;
  accountOpen = true;
  auditReadError = null;
  auditAsks.length = 0;
  updates.length = 0;
  audits.length = 0;
  licenseStatus = "verified";
  doctorExists = true;
  readError = null;
  updateError = null;
});

describe("PATCH /api/admin/doctors/[id]: featured", () => {
  it("stamps featured_at when featuring", async () => {
    expect((await call({ featured: "graduate" })).status).toBe(200);
    expect(updates[0]).toMatchObject({ featured: "graduate" });
    expect(typeof updates[0].featured_at).toBe("string");
    // Every dashboard shows the new featured doctor at once.
    expect(directoryChanged).toHaveBeenCalled();
  });

  it("clears featured_at when unfeaturing", async () => {
    expect((await call({ featured: null })).status).toBe(200);
    expect(updates[0]).toEqual({ featured: null, featured_at: null });
  });

  it("leaves featured_at alone for other fields", async () => {
    expect((await call({ is_active: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_active: false });
  });

  it("rejects an unknown kind", async () => {
    expect((await call({ featured: "vip" })).status).toBe(400);
  });
});

describe("PATCH /api/admin/doctors/[id]: the doctor must exist", () => {
  it("answers 404 rather than writing into nothing", async () => {
    doctorExists = false;
    expect((await call({ is_active: false })).status).toBe(404);
    expect(updates).toEqual([]);
  });
});

describe("PATCH /api/admin/doctors/[id]: accepting a doctor", () => {
  it("answers ok and writes nothing when the doctor is already accepted: no second acceptance time", async () => {
    alreadyAccepted = true;
    const res = await call({ is_admin_approved: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unchanged: true });
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("does not let an admin accept their own account", async () => {
    const res = await call(
      { is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى", approval_method: "institution_called" },
      "00000000-0000-4000-8000-00000000a001",
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("cannot_approve_self");
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("does not accept a closed account, unless the same request opens it", async () => {
    accountOpen = false;
    const body = { is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى", approval_method: "institution_called" };
    const refused = await call(body);
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("account_closed");
    expect(updates).toEqual([]);

    expect((await call({ ...body, is_active: true })).status).toBe(200);
    expect(updates[0]).toMatchObject({ is_admin_approved: true, is_active: true });
  });

  it("still lets a closed account be accepted-off, or an admin change their own other settings", async () => {
    accountOpen = false;
    expect((await call({ is_admin_approved: false })).status).toBe(200);
    expect((await call({ is_visible: false }, "00000000-0000-4000-8000-00000000a001")).status).toBe(200);
  });

  it("wants the method or a note, and nothing at all is refused", async () => {
    licenseStatus = "verified";
    const res = await call({ is_admin_approved: true });
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });

  it("accepts with a note alone", async () => {
    licenseStatus = "verified";
    expect((await call({ is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى" })).status).toBe(200);
    expect(audits[0].metadata).toMatchObject({ approval_reason: "اتصلت بمقسم المستشفى" });
    expect(audits[0].metadata).not.toHaveProperty("approval_method");
  });

  it("accepts with a method alone", async () => {
    licenseStatus = "verified";
    expect((await call({ is_admin_approved: true, approval_method: "known_personally" })).status).toBe(200);
    expect(audits[0].metadata).toMatchObject({ approval_method: "known_personally" });
    expect(audits[0].metadata).not.toHaveProperty("approval_reason");
  });

  it("rejects a reason under ten characters, and a method it does not know", async () => {
    expect((await call({ is_admin_approved: true, approval_reason: "تمام", approval_method: "documents_seen" })).status).toBe(400);
    expect((await call({ is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى", approval_method: "i_think_so" })).status).toBe(400);
  });

  it("asks how the admin knows even when the registry confirms the licence (#16)", async () => {
    licenseStatus = "verified";
    const res = await call({ is_admin_approved: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "approval_reason_required", reason_kind: "identity" });
    expect(updates).toEqual([]);
  });

  it("accepts a registry-confirmed doctor with a reason, logged, without marking the licence reviewed", async () => {
    licenseStatus = "verified";
    expect((await call({ is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى", approval_method: "institution_called" })).status).toBe(200);
    // The time it was accepted, for «جديد هذا الأسبوع».
    // Accepting asks how the admin knew, so it is also the identity review.
    expect(updates[0]).toEqual({ is_admin_approved: true, approved_at: expect.any(String), identity_reviewed_at: expect.any(String) });
    expect(audits[0]).toMatchObject({ metadata: { approval_reason: "اتصلت بمقسم المستشفى", approval_method: "institution_called" } });
  });

  it("counts accepting a doctor with a reason as the licence review, and nothing else does", async () => {
    licenseStatus = "not_found";
    await call({ is_admin_approved: true, approval_reason: "تحققت من الشهادة بالاتصال", approval_method: "documents_seen" });
    expect(updates[0]).toHaveProperty("license_reviewed_at");
    // A verified doctor's reason is about identity, not a licence review.
    updates.length = 0;
    licenseStatus = "verified";
    await call({ is_admin_approved: true, approval_reason: "اتصلت بمقسم المستشفى", approval_method: "institution_called" });
    expect(updates[0]).not.toHaveProperty("license_reviewed_at");
    // Withdrawing acceptance, or any other switch, does not review a licence.
    updates.length = 0;
    await call({ is_visible: false });
    expect(updates[0]).not.toHaveProperty("license_reviewed_at");
  });

  it("refuses an unexplained acceptance when the licence is not confirmed", async () => {
    for (const status of ["soft_match", "not_found", "name_mismatch_overridden", null]) {
      licenseStatus = status;
      const res = await call({ is_admin_approved: true });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("approval_reason_required");
    }
    expect(updates).toEqual([]);
  });

  // A number an admin set by hand (typed, or found by the doctor's own name in
  // the registry) can read "verified" without saying who the doctor is (#16).
  describe("a primary number an admin corrected", () => {
    it("asks for a reason even when the registry confirms it, and says why", async () => {
      licenseStatus = "verified";
      corrected = true;
      const res = await call({ is_admin_approved: true });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "approval_reason_required", reason_kind: "corrected_number" });
      expect(updates).toEqual([]);
    });

    it("looks at this doctor's primary corrections in the log, and nothing else", async () => {
      licenseStatus = "verified";
      corrected = true;
      await call({ is_admin_approved: true });
      expect(auditAsks).toEqual([
        "target_doctor_id=00000000-0000-4000-8000-0000000000d1",
        "action=admin_license_corrected",
        "metadata->>slot=primary",
      ]);
    });

    it("accepts with a reason, and the log says why one was needed", async () => {
      licenseStatus = "verified";
      corrected = true;
      expect((await call({ is_admin_approved: true, approval_reason: "رأيت صورة الهوية الأصلية", approval_method: "documents_seen" })).status).toBe(200);
      expect(audits[0]).toMatchObject({ metadata: { approval_reason: "رأيت صورة الهوية الأصلية", approval_method: "documents_seen", number_corrected_by_admin: true } });
    });

    it("asks about identity, not the number, when nobody corrected it", async () => {
      licenseStatus = "verified";
      expect(await (await call({ is_admin_approved: true })).json()).toMatchObject({ reason_kind: "identity" });
    });

    it("does not look in the log for an unconfirmed licence, which asks anyway, or when not approving", async () => {
      licenseStatus = "not_found";
      expect((await (await call({ is_admin_approved: true })).json()).reason_kind).toBeUndefined();
      licenseStatus = "verified";
      await call({ is_visible: false });
      await call({ is_admin_approved: false });
      expect(auditAsks).toEqual([]);
    });

    it("refuses rather than approving when the log cannot be read", async () => {
      licenseStatus = "verified";
      auditReadError = { code: "XX000" };
      expect((await call({ is_admin_approved: true })).status).toBe(500);
      expect(updates).toEqual([]);
    });
  });

  it("accepts with a reason, and keeps it in the log", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: true, approval_reason: "راجعت صورة الشهادة الأصلية", approval_method: "documents_seen" })).status).toBe(200);
    expect(audits[0]).toMatchObject({
      action: "admin_doctor_updated",
      metadata: {
        is_admin_approved: true,
        approval_reason: "راجعت صورة الشهادة الأصلية",
        approval_method: "documents_seen",
        license_status_at_approval: "not_found",
      },
    });
  });

  // approval_reason is not a column; sending it to .update() would fail.
  it("never writes the reason as a column", async () => {
    licenseStatus = "soft_match";
    await call({ is_admin_approved: true, approval_reason: "تحققت هاتفيًا من المستشفى", approval_method: "institution_called" });
    expect(updates[0]).toEqual({ is_admin_approved: true, approved_at: expect.any(String), identity_reviewed_at: expect.any(String), license_reviewed_at: expect.any(String) });
    expect(updates[0]).not.toHaveProperty("approval_reason");
  });

  it("rejects a reason too short to mean anything", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: true, approval_reason: "ok" })).status).toBe(400);
  });

  it("wants no reason for withdrawing acceptance, only for granting it", async () => {
    licenseStatus = "not_found";
    expect((await call({ is_admin_approved: false })).status).toBe(200);
    // Withdrawn: no acceptance time either.
    expect(updates[0]).toEqual({ is_admin_approved: false, approved_at: null });
  });

  it("asks for a change to make", async () => {
    expect((await call({ approval_reason: "بدون تغيير" })).status).toBe(400);
  });
});

describe("PATCH /api/admin/doctors/[id]: the three switches", () => {
  it("writes directory visibility, which no screen used to send", async () => {
    expect((await call({ is_visible: false })).status).toBe(200);
    expect(updates[0]).toEqual({ is_visible: false });
  });

  it("keeps the three independent, touching only what was asked", async () => {
    await call({ is_active: false });
    // What reaches the database: the update goes as JSON, which leaves out
    // the fields the body didn't name.
    const sent = JSON.parse(JSON.stringify(updates[0]));
    expect(sent).toEqual({ is_active: false });
    expect(sent).not.toHaveProperty("is_visible");
    expect(sent).not.toHaveProperty("is_admin_approved");
  });
});

describe("PATCH /api/admin/doctors/[id]: who and which", () => {
  it("answers 404 for a malformed id instead of failing the read", async () => {
    expect((await call({ is_visible: false }, "abc")).status).toBe(404);
    expect(updates).toEqual([]);
  });

  it("answers 401 to a non-admin", async () => {
    requireAdminOrNull.mockResolvedValueOnce(null);
    expect((await call({ is_visible: false })).status).toBe(401);
  });

  it("answers 500, not 401, when the admin lookup itself fails", async () => {
    requireAdminOrNull.mockRejectedValueOnce(new Error("db down"));
    expect((await call({ is_visible: false })).status).toBe(500);
  });
});

describe("PATCH /api/admin/doctors/[id]: failures", () => {
  it("answers 500 and changes nothing when the doctor cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readError = { code: "XX000", message: "boom" };
    expect((await call({ is_visible: false })).status).toBe(500);
    expect(updates).toHaveLength(0);
  });

  it("answers 500, without auditing or clearing the cache, when the update fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    updateError = { message: "boom" };
    directoryChanged.mockClear();
    expect((await call({ is_visible: false })).status).toBe(500);
    expect(audits).toHaveLength(0);
    expect(directoryChanged).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/doctors/[id]: two things at once", () => {
  const accept = { is_admin_approved: true, approval_method: "known_personally" };

  it("accepts only a doctor who is still waiting and still open", async () => {
    expect((await call(accept)).status).toBe(200);
    expect(updateEqs).toEqual(expect.arrayContaining(["id=00000000-0000-4000-8000-0000000000d1", "is_admin_approved=false", "is_active=true"]));
  });

  it("does not insist on an open account when the same request opens it", async () => {
    accountOpen = false;
    expect((await call({ ...accept, is_active: true })).status).toBe(200);
    expect(updateEqs).not.toContain("is_active=true");
  });

  it("leaves other edits unconditional", async () => {
    await call({ featured: "graduate" });
    expect(updateEqs).toEqual(["id=00000000-0000-4000-8000-0000000000d1"]);
  });

  it("answers 'already accepted' when another admin accepted first, and writes no second audit row", async () => {
    acceptLands = false;
    approvedMeanwhile = true;
    const res = await call(accept);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ unchanged: true });
    expect(audits).toHaveLength(0);
    expect(directoryChanged).not.toHaveBeenCalled();
  });

  it("refuses with account_closed when a deletion request closed the account first", async () => {
    acceptLands = false;
    const res = await call(accept);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "account_closed" });
    expect(audits).toHaveLength(0);
  });
});

describe("PATCH /api/admin/doctors/[id]: another admin", () => {
  it("is refused for an admin who is not a super admin, before anything is written", async () => {
    targetIsAdmin = true;
    const res = await call({ is_active: false });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "admin_protected" });
    expect(updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });
});
