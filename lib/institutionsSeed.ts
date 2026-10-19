// The starting institutions list (migration 0016 inserts exactly these).
// Spellings come from what doctors actually typed. Admins maintain the list
// from /admin/institutions afterwards; this file is not read at runtime.

import type { InstitutionKind } from "@/lib/institutions";

export const INSTITUTIONS_SEED: {
  name_ar: string;
  name_he: string | null;
  kind: InstitutionKind;
  aliases: string[];
}[] = [
  { name_ar: "هداسا عين كارم", name_he: "הדסה עין כרם", kind: "hospital",
    aliases: ["عين كارم", "عين كرم", "עין כרם"] },
  { name_ar: "هداسا جبل المشارف", name_he: "הדסה הר הצופים", kind: "hospital",
    aliases: ["هداسا العيسوية", "العيسوية", "جبل المشارف", "هار هتسوفيم", "هار هتسوفين", "הר הצופים"] },
  { name_ar: "هداسا (الفرعان)", name_he: "הדסה", kind: "hospital",
    aliases: ["هداسا"] },
  { name_ar: "شعاري تسيدك", name_he: "שערי צדק", kind: "hospital",
    aliases: ["شعري تسيدك", "شعري تصيدق", "شعري تصيديق", "شعريه تسيدك", "شعاري تصيدق", "شعاريه تسيدك"] },
  { name_ar: "المقاصد", name_he: "מקאסד", kind: "hospital",
    aliases: ["مقاصد", "מוקאסד"] },
  { name_ar: "المطّلع (أوغستا فكتوريا)", name_he: "אוגוסטה ויקטוריה", kind: "hospital",
    aliases: ["المطلع", "اوغستا فكتوريا", "أوغستا فيكتوريا"] },
  { name_ar: "مستشفى سانت جوزيف (الفرنساوي)", name_he: "סנט ג'וזף", kind: "hospital",
    aliases: ["الفرنساوي", "سانت جوزيف", "سان جوزيف"] },
  { name_ar: "مستشفى الهلال الأحمر", name_he: null, kind: "hospital",
    aliases: ["الهلال الاحمر"] },
  { name_ar: "مستشفى العيون سانت جون", name_he: "סנט ג'ון", kind: "hospital",
    aliases: ["سانت جون", "مستشفى العيون"] },
  { name_ar: "مستشفى هرتسوغ", name_he: "הרצוג", kind: "hospital",
    aliases: ["هرتسوغ", "هرتسوج"] },
  { name_ar: "مستشفى ألين", name_he: "אלין", kind: "hospital",
    aliases: ["مستشفى الين"] },
  { name_ar: "مسغاف لداخ", name_he: "משגב לדך", kind: "hospital",
    aliases: ["لداخ", "مسجات لداخ", "مسجاف لداخ"] },
  { name_ar: "مركز القدس للصحة النفسية (كفار شاؤول)", name_he: "המרכז הירושלמי לבריאות הנפש", kind: "hospital",
    aliases: ["كفار شؤول", "كفار شاؤول", "كفار شاول", "مركز القدس للصحة النفسية", "כפר שאול", "לבריאות הנפש"] },
  { name_ar: "بيت بالب", name_he: "בית בלב", kind: "hospital",
    aliases: ["بيت بلب"] },
  { name_ar: "مستشفى هشارون", name_he: "השרון", kind: "hospital",
    aliases: ["هشارون"] },
  { name_ar: "مستشفى أسوتا", name_he: "אסותא", kind: "hospital",
    aliases: ["أسوتا", "اسوتا"] },
  { name_ar: "مستشفى برزلاي", name_he: "ברזילי", kind: "hospital",
    aliases: ["برزلاي", "برزيلاي"] },
  { name_ar: "مستشفى وولفسون", name_he: "וולפסון", kind: "hospital",
    aliases: ["وولفسون", "ولفسون"] },
  { name_ar: "مستشفى أساف هروفيه (شمير)", name_he: "שמיר אסף הרופא", kind: "hospital",
    aliases: ["اساف هروفا", "اساف هروفيه", "شمير", "אסף הרופא"] },
  { name_ar: "كلاليت", name_he: "כללית", kind: "hmo", aliases: [] },
  { name_ar: "مكابي", name_he: "מכבי", kind: "hmo", aliases: [] },
  { name_ar: "مئوحيدت", name_he: "מאוחדת", kind: "hmo",
    aliases: ["موحيدت", "مؤحيدت", "مؤوحيدت"] },
  { name_ar: "لئوميت", name_he: "לאומית", kind: "hmo",
    aliases: ["لؤميت", "لؤوميت", "ليئوميت"] },
  { name_ar: "تيريم", name_he: "טרם", kind: "clinic_network", aliases: [] },
];
