// Doctors on an Arabic keyboard type ١٢٣ (U+0660..0669), and some Android
// layouts emit the Eastern variant ۱۲۳ (U+06F0..06F9). Every numeric input
// (phone, license) maps them to ASCII before anything else looks at it.

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

export function toAsciiDigits(s: string): string {
  return s.replace(ARABIC_INDIC, (d) => String(d.charCodeAt(0) & 0xf));
}
