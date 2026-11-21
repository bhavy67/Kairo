# Design system: "quiet instrument"

Kairo is opened once a day, after the close, for about two minutes. Every screen answers, in order: how am I doing, what changed, does anything need me.

## Principles
1. **The numbers are the interface.** Chrome is monochrome and recedes; one hero number per page.
2. **Colour means something or it is absent.** Muted green and red only for gain and loss, always with ▲/▼. Parts of a whole use a grey ramp with direct labels. No accent colour, no gradients.
3. **Motion explains change.** Numbers roll only when data changes; pages fade in; charts draw once. 150–450 ms, ease-out, no bounce; `prefers-reduced-motion` disables it.
4. **Every ticker goes somewhere.** Any symbol opens its stock page; ⌘K reaches any page or stock.

## Tokens (`apps/web/src/app/globals.css`)
| | Light | Dark |
|---|---|---|
| Background | `#f6f6f4` | `#0f0f0e` |
| Surface | `#ffffff` | `#161615` |
| Ink | `#0e0e0e` | `#f0efec` |
| Gain / loss (text) | `#0f7a3d` / `#b42318` | `#4cc27a` / `#f0705f` |

Dark mode is designed, not inverted. The app follows the device theme; one toggle flips light and dark, and a flip that matches the device drops the override. The choice is stored per device and applied before first paint, along with the phone status-bar colour.

## Type
- Inter (variable, optical sizes) for text; the hero uses the display cut at −0.045em.
- JetBrains Mono for tickers, uppercase labels and keyboard hints.
- Page titles end with the brand's faint full stop.

## Logo
A solid tile with a rising line that ends in a separate dot, today's close, which echoes the wordmark's closing stop. The wordmark is Inter Display Bold with a "₹" in place of the "r", drawn from Inter Display Black and condensed onto the x-height so its weight matches. `components/Logo.tsx`, `app/icon.svg` and the raster icons are generated from the glyph outlines; do not hand-edit.

## Navigation
Five tabs: Today, Portfolio (Holdings · Funds · Returns), Markets (India · Global), Screener, Watch (Watchlist · Alerts). Desktop: a top bar with a sliding active pill and ⌘K search. Mobile (< 760 px): a bottom tab bar, with tables rendered as labelled cards.
