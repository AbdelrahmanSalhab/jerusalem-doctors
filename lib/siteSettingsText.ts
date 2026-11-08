// What each directory switch does, in the words /admin/settings shows an admin
// before they flip it, and the activity log uses for its name. The numbers are
// the code's own, so the page cannot drift from what the app enforces.

import { RECENT_DAYS, REVEAL_BUDGET } from "@/lib/contactBudget";
import { SEARCH_PAGE_SIZE } from "@/lib/directory";
import { RATE_LIMITS } from "@/lib/ratelimit";
import type { SettingKey } from "@/lib/siteSettings";

export interface SettingText {
  /** The switch's name; also what the activity log calls it. */
  title: string;
  /** What happens while it is closed, which is how the directory started. */
  closed: string;
  /** What happens once it is open. */
  open: string;
  /** What opening it takes away. */
  gives: string;
  /** What still protects the directory after it is open. */
  stays: string;
}

export const SETTINGS_TEXT: Record<SettingKey, SettingText> = {
  search_before_review: {
    title: "البحث قبل قبول الحساب",
    closed:
      "الطبيب الجديد يسجّل ويكمل ملفه فقط. لا يبحث ولا يرى بطاقات زملائه حتى يقبل أحد المشرفين حسابه.",
    open:
      "يبحث الطبيب الجديد في الدليل ويرى بطاقات زملائه فور تأكيد هاتفه، وهو بانتظار المراجعة. اسمه لا يظهر لزملائه حتى يُقبل.",
    gives:
      "سجل وزارة الصحة علني، فمن يكتب اسم طبيب ورقم ترخيصه يجتاز التحقق عند التسجيل. كان قبول المشرف هو الحاجز الوحيد أمام المنتحل، فبعد فتح هذا المفتاح يدخل الدليل قبل أن يتأكد منه أحد.",
    stays: `أرقام الزملاء وبريدهم تبقى خلف النقر، وحدّ الحساب الذي لم يُقبل ${REVEAL_BUDGET.recent} أطباء في اليوم. واسمه لا يدخل الدليل قبل القبول.`,
  },
  contacts_without_tap: {
    title: "إظهار الهاتف والبريد مباشرة",
    closed: `تحمل البطاقة الاسم والتخصص ومكان العمل. الهاتف والبريد وواتساب تظهر بعد النقر على «إظهار الهاتف والبريد»، ولكل حساب حدّ يومي: ${REVEAL_BUDGET.established} طبيبًا، و${REVEAL_BUDGET.recent} في أول ${RECENT_DAYS} يومًا بعد قبوله.`,
    open: "تظهر الأرقام والبريد على البطاقة مباشرة بلا نقر، في البحث وفي أقسام الصفحة الرئيسية، للأطباء المقبولين فقط. الحساب الذي ما زال بانتظار المراجعة يبقى على النقر وحدّه اليومي، حتى لو فُتح له البحث.",
    gives: `يُلغى الحدّ اليومي لأن النقر هو ما كان يُحصى، فلا يُعرف كم رقمًا أخذ حساب ما. وحساب قُبل بالخطأ يستطيع نسخ أرقام الدليل كلها في دقائق، ${SEARCH_PAGE_SIZE} طبيبًا في كل بحث، ولن يصلك تنبيه على إظهار الأرقام.`,
    stays: `يبقى حدّ البحث: ${RATE_LIMITS.search.limit} بحثًا في الدقيقة و${RATE_LIMITS.searchDaily.limit} في اليوم، وعند بلوغ الحد اليومي يصلك تنبيه.`,
  },
};
