import type { CSSProperties } from 'react'

/**
 * Shared helpers for the responsive layer in app/responsive.css.
 *
 * These exist so a component can hand a value to the stylesheet without
 * reimplementing the breakpoint itself. Nothing here reads the viewport: the
 * decision about what a given width can afford stays in the media queries, so
 * the server and the browser always render the same markup.
 */

/**
 * Desktop width of a `.cleo-modal-card`.
 *
 * The class caps its own width at `--cleo-modal-w` and drops to the full
 * viewport, minus the safe area, on a phone. Setting the variable rather than
 * an inline `maxWidth` is what lets the small-screen rule win, because an
 * inline declaration would outrank it.
 */
export function modalWidth(px: number): CSSProperties {
  return { '--cleo-modal-w': `${px}px` } as CSSProperties
}

/**
 * Preferred tile size for a `.cleo-tiles` grid: `px` on a roomy viewport,
 * `smallPx` once the grid has to pack tighter. Both are minimums for
 * `auto-fill`, so tiles still stretch to use the row.
 */
export function tileSize(px: number, smallPx: number): CSSProperties {
  return { '--cleo-tile': `${px}px`, '--cleo-tile-sm': `${smallPx}px` } as CSSProperties
}
