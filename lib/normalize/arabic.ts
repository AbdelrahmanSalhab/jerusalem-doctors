// Normalize Arabic text for indexing and search.
// Mirrored verbatim by the SQL function `normalize_arabic` (migration 0001).
// If you change the rules here, change them in SQL too.
//
// Rules (per spec §9):
//   alef hamza forms U+0623, U+0625, U+0622, U+0671  -> alef    U+0627
//   waw hamza        U+0624                          -> waw     U+0648
//   ya hamza         U+0626                          -> ya      U+064A
//   alef maksura     U+0649                          -> ya      U+064A
//   tatweel          U+0640                          -> removed
//   diacritics       U+064B - U+065F                 -> removed
//   dagger alef      U+0670                          -> removed
//   collapse whitespace, trim, lowercase
//
// IMPORTANT: the diacritics range is U+064B–U+065F only. Do NOT extend it to
// U+0670 in a single character class — that range silently swallows the
// Arabic-Indic digits U+0660–U+0669 and the punctuation block U+066A–U+066F,
// breaking phone numbers, dates, license numbers, etc. typed in Arabic. Use
// a separate replace for the dagger alef instead.

const HAMZA_FORMS = /[أإآٱ]/g;
const WAW_HAMZA = /ؤ/g;
const YA_HAMZA = /ئ/g;
const ALEF_MAKSURA = /ى/g;
const TATWEEL = /ـ/g;
const DIACRITICS = /[ً-ٟ]/g;
const DAGGER_ALEF = /ٰ/g;
const COLLAPSE_WS = /\s+/g;

const ALEF = "ا";
const WAW = "و";
const YA = "ي";

export function normalizeArabic(input: string): string {
  return input
    .replace(HAMZA_FORMS, ALEF)
    .replace(WAW_HAMZA, WAW)
    .replace(YA_HAMZA, YA)
    .replace(ALEF_MAKSURA, YA)
    .replace(TATWEEL, "")
    .replace(DIACRITICS, "")
    .replace(DAGGER_ALEF, "")
    .replace(COLLAPSE_WS, " ")
    .trim()
    .toLowerCase();
}
