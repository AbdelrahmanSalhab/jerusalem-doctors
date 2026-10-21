// Arabic nouns change form with the number in front of them: one (طبيب
// واحد), two (طبيبان), 3 to 10 take the plural (5 أطباء), 11 to 99 the
// singular accusative (24 طبيبًا), and round hundreds the singular (100
// طبيب). These pick the right one so the UI never reads "24 أطباء".

export interface NounForms {
  one: string;
  two: string;
  /** 3 to 10, and zero. */
  few: string;
  /** 11 to 99. */
  many: string;
  /** After 100, 200, ... (and their 1 and 2). */
  hundred: string;
}

export const DOCTORS: NounForms = { one: "طبيب واحد", two: "طبيبان", few: "أطباء", many: "طبيبًا", hundred: "طبيب" };
/** After a preposition (مع، من): genitive two. */
export const COLLEAGUES_GEN: NounForms = { one: "زميل واحد", two: "زميلين", few: "زملاء", many: "زميلًا", hundred: "زميل" };

export const ALERT_NOUN: NounForms = { one: "تنبيه واحد", two: "تنبيهان", few: "تنبيهات", many: "تنبيهًا", hundred: "تنبيه" };

export const EVENTS: NounForms = { one: "حدث واحد", two: "حدثان", few: "أحداث", many: "حدثًا", hundred: "حدث" };

export function countOf(n: number, f: NounForms): string {
  if (n === 1) return f.one;
  if (n === 2) return f.two;
  const r = n % 100;
  if (n === 0 || (r >= 3 && r <= 10)) return `${n} ${f.few}`;
  if (r >= 11) return `${n} ${f.many}`;
  return `${n} ${f.hundred}`;
}

/** "اليوم", "منذ يوم", "منذ يومين", "منذ 5 أيام", "منذ 12 يومًا". */
export function daysAgoText(days: number): string {
  if (days <= 0) return "اليوم";
  if (days === 1) return "منذ يوم";
  if (days === 2) return "منذ يومين";
  const r = days % 100;
  if (r >= 3 && r <= 10) return `منذ ${days} أيام`;
  if (r >= 11) return `منذ ${days} يومًا`;
  return `منذ ${days} يوم`;
}
