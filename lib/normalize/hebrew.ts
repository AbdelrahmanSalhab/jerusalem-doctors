// Normalize Hebrew text for license-registry name matching (see plan §13).
//
// The Israel MoH registry stores plain Hebrew names; user input may include
// niqqud (vowel marks), cantillation marks, gershayim/geresh punctuation, and
// non-NFKC sequences. To get a stable equality check, we strip combining
// marks and the gershayim family, normalize to NFKC, and collapse whitespace.
//
// Rules:
//   NFKC normalize first (canonicalises decomposed sequences).
//   strip Hebrew combining marks U+0591–U+05C7 (niqqud + cantillation + meteg + dagesh).
//   strip gershayim/geresh punctuation (", ', U+05F3, U+05F4) used in
//       abbreviations like ד"ר ("Dr.").
//   collapse whitespace, trim. NO lowercasing (Hebrew has no case).

const HEBREW_MARKS = /[֑-ׇ]/g; // U+0591 – U+05C7 (combining marks block)
const GERSHAYIM = /["'׳״]/g; // " ' geresh U+05F3 gershayim U+05F4
const COLLAPSE_WS = /\s+/g;

export function normalizeHebrew(input: string): string {
  return input
    .normalize("NFKC")
    .replace(HEBREW_MARKS, "")
    .replace(GERSHAYIM, "")
    .replace(COLLAPSE_WS, " ")
    .trim();
}
