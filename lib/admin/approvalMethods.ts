// How an admin knew a new doctor is who they say (#16). Accepting asks for one
// of these and a few words, because a registry match is public data and proves
// nothing about who is typing, and a number on the applicant's own profile (or
// their phone) is theirs to answer. Kept in the activity log with the reason.

export const APPROVAL_METHODS = [
  { key: "known_personally", label: "أعرفه شخصيًا" },
  { key: "colleague_vouched", label: "زميل أعرفه ويوثق به أكّد لي أنه هو" },
  { key: "institution_called", label: "اتصلت بمكان عمله على رقم بحثت عنه بنفسي (مقسم المستشفى مثلًا)" },
  { key: "documents_seen", label: "رأيت صورة ترخيصه أو هويته" },
] as const;

export type ApprovalMethod = (typeof APPROVAL_METHODS)[number]["key"];
export const APPROVAL_METHOD_KEYS = APPROVAL_METHODS.map((m) => m.key) as [ApprovalMethod, ...ApprovalMethod[]];

export const approvalMethodLabel = (key: unknown) => APPROVAL_METHODS.find((m) => m.key === key)?.label ?? String(key);

/** Shortest reason that says anything: three characters passed for "ok". */
export const APPROVAL_REASON_MIN = 10;
