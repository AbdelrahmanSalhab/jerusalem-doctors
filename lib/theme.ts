// Theme choice: "auto" follows the device; "light"/"dark" are the visitor's
// pick, kept in localStorage on this device. The resolved theme lives on
// <html data-theme>, which globals.css keys every colour on.

export const THEME_KEY = "theme";
export const THEMES = ["auto", "light", "dark"] as const;
export type ThemeChoice = (typeof THEMES)[number];

/**
 * Runs inline in <head> before the first paint, so the page never flashes
 * the wrong theme. Plain ES5 on purpose: it is a string, not bundled code.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var c=localStorage.getItem("${THEME_KEY}");
var m=window.matchMedia("(prefers-color-scheme: dark)");
function apply(){var d=c==="dark"||(c!=="light"&&m.matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}
apply();
m.addEventListener("change",function(){c=localStorage.getItem("${THEME_KEY}");apply();});
}catch(e){}})();`;
