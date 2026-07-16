/* ===========================================================================
 * InterlinedList brand values (name / wordmark / logo).
 * Derived from interlinedlist.com on 2026-07-15 (site HTML, favicon.svg, and the
 * production _next CSS token bundle) — replace with the official asset pack when
 * provided. Centralized here + in src/styles/brand.css so a future swap is one edit.
 * =========================================================================== */

/** Full product name shown in headers, titles, and about copy. */
export const PRODUCT_NAME = "InterlinedList Offline";

/** The company/site the app authenticates against. */
export const IL_SITE_NAME = "InterlinedList";
export const IL_SITE_URL = "https://interlinedlist.com";

/**
 * Wordmark as two parts so "Offline" can render lighter than "InterlinedList".
 * The live site renders the wordmark as plain PascalCase text ("InterlinedList",
 * font-weight:bold, Space Grotesk) next to the icon — matched here.
 */
export const WORDMARK = {
  primary: "InterlinedList",
  suffix: "Offline",
};

/**
 * Inline SVG logo — a stylized "IL"/list monogram approximating the real
 * interlinedlist.com favicon mark: a stem with three "list" rows and an
 * interlink loop. The real mark is multi-color (teal/green/amber); this default
 * renders monochrome via `currentColor` so callers control the color
 * (default --il-primary). For the full-color version see src/assets/logo.svg.
 * Approximation — replace with the official logo when the asset pack lands.
 */
export function logoSvg(size = 28): string {
  return `
<svg width="${size}" height="${size}" viewBox="0 0 32 32" fill="none"
     xmlns="http://www.w3.org/2000/svg" role="img" aria-label="InterlinedList logo">
  <!-- Approximation of the interlinedlist.com favicon: list rows + interlink loop -->
  <g stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
    <line x1="6.5" y1="7" x2="6.5" y2="25"/>
    <line x1="6.5" y1="9.5"  x2="18" y2="9.5"/>
    <line x1="6.5" y1="16"   x2="15" y2="16"/>
    <line x1="6.5" y1="22.5" x2="15" y2="22.5"/>
    <path d="M18.5 8.5 a6 6 0 0 1 6 6 v3 a6 6 0 0 1 -6 6 h-2"/>
  </g>
</svg>`.trim();
}
