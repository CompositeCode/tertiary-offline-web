/* ===========================================================================
 * InterlinedList brand values (name / wordmark / logo).
 * PLACEHOLDER — replace with official InterlinedList assets.
 * Centralized here + in src/styles/brand.css so official assets swap in
 * without touching feature code.
 * =========================================================================== */

/** Full product name shown in headers, titles, and about copy. */
export const PRODUCT_NAME = "InterlinedList Offline";

/** The company/site the app authenticates against. */
export const IL_SITE_NAME = "InterlinedList";
export const IL_SITE_URL = "https://interlinedlist.com";

/**
 * Wordmark as two parts so "Offline" can render lighter than "InterlinedList".
 * PLACEHOLDER — replace with official wordmark asset.
 */
export const WORDMARK = {
  primary: "InterlinedList",
  suffix: "Offline",
};

/**
 * Inline SVG logo — two interlocking links/rings evoking "interlinked".
 * PLACEHOLDER — replace with the official InterlinedList logo file.
 * Uses currentColor so callers control the color (default --il-primary).
 */
export function logoSvg(size = 28): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
     xmlns="http://www.w3.org/2000/svg" role="img" aria-label="InterlinedList logo">
  <!-- PLACEHOLDER — two interlocking links -->
  <rect x="3" y="9.5" width="17" height="13" rx="6.5"
        stroke="currentColor" stroke-width="2.6" fill="none"/>
  <rect x="12" y="9.5" width="17" height="13" rx="6.5"
        stroke="currentColor" stroke-width="2.6" fill="none"/>
</svg>`.trim();
}
