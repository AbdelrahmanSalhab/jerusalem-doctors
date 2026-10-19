// Why a licence came out verified, partly matched, or not found.
//
// The admin panel used to show a bare chip with no way to ask "why?", because
// the reasoning happened once at signup and nothing about it was kept: not the
// registry row, not its spelling of the name, not which similarity rule fired,
// not even whether the registry was reachable. See lib/moh/match.ts.
//
// So the explanation is rebuilt here from what we do have: the stored status,
// the registry copy as it stands today, and the readings the typed number
// could have had. Where that reasoning comes from today's copy rather than
// from what was seen at signup, `derivedNow` says so, because the registry
// can change under us and an admin deserves to know which is which.

import type { MirrorPractitioner } from "./mirror";
import { nameMatchRule, type NameMatch, type NameMatchRule } from "./match";
import { normalizeHebrew } from "@/lib/normalize/hebrew";
import { ilLicenseCandidates } from "@/lib/normalize/license";
import type { StatusTone } from "@/lib/licenseStatus";

export type ExplainCode =
  | "verified_exact"
  | "soft_match_rules"
  | "soft_match_unknown_rule"
  | "not_found_ps"
  | "not_found_absent"
  | "not_found_now_present"
  | "not_found_no_hebrew_name"
  | "mismatch_overridden"
  | "mismatch_overridden_row_gone"
  | "unchecked";

export interface LicenseExplanation {
  code: ExplainCode;
  tone: StatusTone;
  headline: string;
  reasons: string[];
  nextStep: string | null;
  /** The reasoning came from today's registry copy, not from signup. */
  derivedNow: boolean;
}

export interface ExplainInput {
  /** doctors.license_verification_status, or the secondary one. */
  status: string | null;
  region: string | null;
  /** The stored serial, i.e. the reading that won at signup. */
  licenseNumber: string | null;
  hebrewFirstName: string | null;
  hebrewFamilyName: string | null;
  /** The registry row for the stored serial, if the copy still has it. */
  registryRow: MirrorPractitioner | null;
  /** When the registry copy was last refreshed. */
  mirrorSyncedAt: string | null;
  licenseVerifiedAt: string | null;
  /** This doctor also holds an Israeli licence in the other slot. */
  hasSecondaryIl?: boolean;
  /** Fresh comparison, when the caller has just re-run the check. */
  match?: NameMatch;
}

/** Jerusalem date, no time: these are "when did we last sync" facts. */
export function explainDate(iso: string | null): string {
  if (!iso) return "غير معروف";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "غير معروف";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Licence numbers are Latin digits inside Arabic text, so they get the
 *  directional marks that keep them from reordering. */
function ltr(n: string | null): string {
  return `‎${n ?? ""}‎`;
}

const NAME_PART = { first: "الاسم الأول", family: "اسم العائلة" } as const;

const RULE_REASON: Record<NameMatchRule, string> = {
  exact: "مطابق تمامًا.",
  substring: "أحد الاسمين يحتوي الآخر (اسم مركّب أو مختصر).",
  edit1: "حرف واحد فقط يختلف (خطأ إملائي أو كتابة مختلفة للاسم نفسه).",
  none: "مختلف تمامًا.",
};

const registryName = (row: MirrorPractitioner) => `${row.hebrewFirstName} ${row.hebrewFamilyName}`.trim();

function ourName(input: ExplainInput): string | null {
  const name = `${input.hebrewFirstName ?? ""} ${input.hebrewFamilyName ?? ""}`.trim();
  return name || null;
}

function foundInRegistry(row: MirrorPractitioner): string {
  return `الرقم ${ltr(String(row.licenseNumber))} موجود في السجل باسم: ${registryName(row)}.`;
}

function syncedLine(input: ExplainInput): string {
  return `آخر مزامنة لنسخة السجل: ${explainDate(input.mirrorSyncedAt)}.`;
}

/** The note about a number that could be read two ways, when it applies. */
function ambiguityNote(input: ExplainInput): string | null {
  if (input.region !== "IL" || !input.licenseNumber) return null;
  const candidates = ilLicenseCandidates(input.licenseNumber);
  if (!candidates || candidates.length < 2) return null;
  return `ملاحظة: ${ltr(input.licenseNumber)} يمكن أن يُقرأ بطريقتين (${ltr(candidates[0])} أو ${ltr(candidates[1])} بعد إسقاط رقم المهنة 1)، والمحفوظ هو ${ltr(input.licenseNumber)}.`;
}

function push(list: string[], line: string | null) {
  if (line) list.push(line);
}

export function explainLicense(input: ExplainInput): LicenseExplanation {
  // A Palestinian licence first, before anything reads the status: it is
  // stored as not_found only because there is no registry to look in, and
  // showing that next to real registry misses is what made the panel lie.
  if (input.region === "PS") {
    const reasons = [
      "الطبيب مرخّص من فلسطين، والتحقق الآلي يعمل مع سجل وزارة الصحة الإسرائيلية فقط.",
      "لم تُجرَ أي محاولة بحث لهذا الرقم، فقيمة «غير موجود في السجل» هنا لا تعني أن الرقم خاطئ.",
    ];
    if (input.hasSecondaryIl) reasons.push("للطبيب ترخيص إضافي إسرائيلي؛ راجع حالته أدناه.");
    return {
      code: "not_found_ps",
      tone: "neutral",
      headline: "لم يُفحص: لا يوجد سجل إلكتروني للتراخيص الفلسطينية.",
      reasons,
      nextStep: "تحقّق يدويًا (صورة الشهادة أو مكالمة)، ثم اقبل العضوية مع كتابة سبب القبول.",
      derivedNow: false,
    };
  }

  const row = input.registryRow;
  const match = input.match;

  switch (input.status) {
    case "verified": {
      const reasons: string[] = [];
      push(reasons, row ? foundInRegistry(row) : null);
      reasons.push("الاسم العبري المسجَّل لدينا مطابق تمامًا لما في السجل.");
      if (input.licenseVerifiedAt) reasons.push(`تاريخ التحقق: ${explainDate(input.licenseVerifiedAt)}.`);
      if (row?.specialtyHe) reasons.push(`تخصصه في السجل: ${row.specialtyHe}.`);
      return {
        code: "verified_exact",
        tone: "success",
        headline: "الترخيص مطابق لسجل وزارة الصحة.",
        reasons,
        nextStep: null,
        derivedNow: false,
      };
    }

    case "soft_match": {
      if (!row) {
        return {
          code: "soft_match_unknown_rule",
          tone: "warn",
          headline: "سُجّل كتطابق جزئي عند التسجيل، ولا نستطيع إعادة شرح السبب الآن.",
          reasons: [
            "لم نحفظ تفاصيل المقارنة وقت التسجيل.",
            `الرقم ${ltr(input.licenseNumber)} غير موجود في نسخة السجل الحالية. ${syncedLine(input)}`,
          ],
          nextStep: "اضغط «بحث في السجل» لإعادة الفحص الآن.",
          derivedNow: true,
        };
      }
      const reasons = [foundInRegistry(row)];
      push(reasons, ourName(input) ? `الاسم العبري المسجَّل لدينا: ${ourName(input)}.` : null);
      const rules = match ?? compareStored(input, row);
      reasons.push(`${NAME_PART.first}: ${RULE_REASON[rules.first]}`);
      reasons.push(`${NAME_PART.family}: ${RULE_REASON[rules.family]}`);
      reasons.push(
        "لهذا سُجّل كـ«تطابق جزئي»: الرقم موثوق، والاسم قريب بما يكفي ليحتاج نظرة بشرية، لا بما يكفي للموافقة التلقائية.",
      );
      push(reasons, ambiguityNote(input));
      return {
        code: "soft_match_rules",
        tone: "warn",
        headline: "الرقم مطابق، لكن كتابة الاسم تختلف قليلًا عن السجل.",
        reasons,
        nextStep:
          "إن كانت كتابة السجل هي الصحيحة فالترخيص سليم ويمكنك قبول العضوية. وإن كان الرقم خاطئًا، صحّحه وابحث من جديد.",
        derivedNow: !match,
      };
    }

    case "not_found": {
      if (!ourName(input)) {
        const reasons = ["المطابقة تحتاج الاسم العبري كما في سجل الوزارة، ولا يوجد اسم عبري مسجَّل لهذا الطبيب."];
        push(reasons, row ? foundInRegistry(row) : null);
        return {
          code: "not_found_no_hebrew_name",
          tone: "warn",
          headline: "لا يمكن المطابقة: لا يوجد اسم عبري مسجَّل لهذا الطبيب.",
          reasons,
          nextStep: "راجع الاسم العبري مع الطبيب. البحث بالرقم وحده سيعيد «الاسم لا يطابق السجل».",
          derivedNow: false,
        };
      }
      // The copy has the row today even though the check missed it: either the
      // registry was unreachable that day, or the row arrived in a later sync.
      // Nothing re-matches a doctor after signup, so it has stayed wrong.
      if (row) {
        return {
          code: "not_found_now_present",
          tone: "warn",
          headline: "الرقم موجود في السجل اليوم، لكن الفحص وقت التسجيل لم يجده.",
          reasons: [
            `${foundInRegistry(row)} ${syncedLine(input)}`,
            "يعني ذلك أن الفحص وقت التسجيل فشل (انقطاع في خدمة data.gov.il)، أو أن الصفّ أُضيف للسجل بعد ذلك. لا تُعاد المطابقة تلقائيًا بعد التسجيل.",
          ],
          nextStep: "اضغط «بحث في السجل» لتحديث الحالة الآن دون تعديل الرقم.",
          derivedNow: true,
        };
      }
      const reasons = [
        `بحثنا عن ${ltr(input.licenseNumber)} في نسخة سجل الوزارة فلم نجده. ${syncedLine(input)}`,
        "الأسباب المحتملة: خطأ في الرقم، أو ترخيص صدر بعد آخر تحديث للسجل، أو ترخيص غير إسرائيلي أُدخل كإسرائيلي.",
      ];
      push(reasons, ambiguityNote(input));
      return {
        code: "not_found_absent",
        tone: "warn",
        headline: "الرقم غير موجود في نسخة السجل التي لدينا.",
        reasons,
        nextStep: "اضغط «بحث في السجل» للبحث مباشرةً في موقع الوزارة الآن، أو صحّح الرقم وابحث من جديد.",
        derivedNow: true,
      };
    }

    case "name_mismatch_overridden": {
      const headline = "الاسم العبري لا يطابق السجل، وقد تجاوز الطبيب التحذير بنفسه وقت التسجيل.";
      const nextStep = "تأكد أن الرقم يخصّ هذا الطبيب فعلًا قبل قبول العضوية. إن كان خاطئًا، صحّحه وابحث من جديد.";
      if (!row) {
        return {
          code: "mismatch_overridden_row_gone",
          tone: "danger",
          headline,
          reasons: [
            `الرقم ${ltr(input.licenseNumber)} غير موجود في نسخة السجل الحالية، فلا يمكن عرض كتابة السجل. ${syncedLine(input)}`,
          ],
          nextStep,
          derivedNow: true,
        };
      }
      const reasons = [foundInRegistry(row)];
      push(reasons, ourName(input) ? `الاسم العبري المسجَّل لدينا: ${ourName(input)}.` : null);
      reasons.push("وافق الطبيب على المتابعة رغم الاختلاف، ولم يراجع أحد الحالة بعد ذلك.");
      return { code: "mismatch_overridden", tone: "danger", headline, reasons, nextStep, derivedNow: true };
    }

    default:
      return {
        code: "unchecked",
        tone: "neutral",
        headline: "لم تُسجَّل أي نتيجة تحقق لهذا الترخيص.",
        reasons: ["هذا يحدث لحسابات أُنشئت قبل تشغيل التحقق، أو لحالة «اسم غير مطابق» لم تُحفظ."],
        nextStep: "اضغط «بحث في السجل» لفحصه الآن.",
        derivedNow: false,
      };
  }
}

/** The comparison as it stands today, when the caller has not just run one. */
function compareStored(input: ExplainInput, row: MirrorPractitioner): NameMatch {
  return {
    first: nameMatchRule(normalizeHebrew(input.hebrewFirstName ?? ""), row.hebrewFirstNorm),
    family: nameMatchRule(normalizeHebrew(input.hebrewFamilyName ?? ""), row.hebrewFamilyNorm),
  };
}
