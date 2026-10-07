# MQSF corporate identity

Use this guide for the event website, programs, logo downloads, and future
editions. It records the established MQSF design and review targets for new
work. It is not an accessibility certification.

## Logos

The [logos page](https://munich-quantum-software.github.io/mqsf/logos/) provides the full logo for light and dark backgrounds,
with and without the 2026 date, in SVG and PNG. It has direct downloads and links
for copying images. Year-neutral artwork lives in `assets/images/brand/`; dated
artwork belongs to `2026/assets/event/`.

- Keep the original proportions and colors: blue `#006fb7`, with charcoal
  `#3d3d3c` lettering on light surfaces or white lettering on dark surfaces.
- Use the supplied light/dark variants rather than recoloring the logo. All
  downloads have transparent backgrounds. Use dated artwork only for its edition.
- Keep clear space around the visible artwork, at least one quarter of the
  logo symbol's height. Do not stretch, crop, recolor, or add effects to the logo.
- Prefer SVG for scalable artwork and PNG for applications that require a
  bitmap. Preserve the source SVG when exporting another format.

The downloads follow the direct preview/format-link approach of the
[MQT logos page](https://mqt.readthedocs.io/en/latest/logos.html).

## Typography

Use Poppins with a system sans-serif fallback. The landing page and logo page use
the licensed local files in `assets/fonts/` (license: `OFL.txt`); the program
currently loads Poppins 400/600 from Google Fonts. Use weights that the page loads.

| Role | CSS size | Desktop | Mobile, at most 700px wide |
| --- | --- | --- | --- |
| Small text: navigation, durations, compact details | `.875rem` | 14px | 14px |
| Body: prose, controls, general content | `1rem` | 16px | 16px |
| Headings, prominent names and dates | `1.75rem` | 28px | 16px |

These pixel equivalents assume the browser's normal 16px root size. Keep sizes in
`rem` and honor user text enlargement. Mobile uses only the two smaller sizes.

Light pages use weight 300 for body text, 500 for headings, and 700 for emphasis.
The dark program uses weight 400 for text and names; meet-up headings may use 600.
Keep semantic heading levels even when mobile headings have the same font size.
Use spacing, weight, and color to distinguish them.

Use unitless line heights: 1.5–1.8 for paragraphs and 1.1–1.35 for short headings.
Prefer left-aligned prose on new pages and approximately 45–90 characters per
line, aiming near 66 for longer text. Preserve the deliberate alignment of
existing event sections when editing their content. These readability targets
come from [USWDS typography guidance](https://designsystem.digital.gov/components/typography/);
the exact MQSF font sizes and weights are our design choices.

## Color roles

| Role | Value | Established use |
| --- | --- | --- |
| Brand blue | `#006fb7` | Links, accents, primary buttons, logo |
| Logo charcoal | `#3d3d3c` | Full-logo lettering |
| Hero / wave navy | `#17213c` | Background artwork and event hero |
| Program navy | `#18233c` | Program page base |
| White | `#ffffff` | Landing panels, calendar, button text |
| Light section gray | `#e5e5e5` | Alternating event sections |
| Text on light surfaces | `#171717` | Event prose |
| Text on dark surfaces | `#f5f7fa` | Program names and headings |
| Muted text on dark surfaces | `#aab5c3` | Program details |
| Calendar ink / muted / border | `#182840` / `#607087` / `#e4eaf1` | Meet-up UI |
| Program card | `rgba(6, 17, 31, .64)` | Translucent talk cards |

Choose foreground and background together. For 14/16px text, check at least
4.5:1 contrast; regular 28px text requires at least 3:1. Blue on white is suitable
for body links; blue on navy should be decorative rather than small text. Check
translucent surfaces over the actual background. These are
[WCAG contrast review targets](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
not a claim that every existing combination has been audited.

## Spacing and layout

Prefer the MQSF scale **4, 8, 12, 16, 24, 32, 48, 64, 72px** for new spacing.
Use smaller gaps within related content and larger gaps between sections.
This is informed by [Carbon's spacing principles](https://www.carbondesignsystem.com/building-blocks/foundations/spacing/overview);
existing optical adjustments need not be mechanically rounded to this scale.

| Element | MQSF reference |
| --- | --- |
| Event content width | At most 1160px |
| Program content width | At most 1120px |
| Mobile outer gutters | Usually 16–24px |
| Panel / card padding | Usually 16–32px, smaller within dense calendar cells |
| Section separation | Usually 48–72px; event mobile sections use 44px |
| Related controls / text | Usually 8–16px apart |

Existing layout breakpoints are 640px for the event page, 680px for the program
header/cards, and 700px for the calendar. The shared mobile type rule is 700px.
Keep these boundaries when adjusting existing components.

## Cards, imagery, and motion

- Use **10px corners** on cards, panels, controls, dialogs, and rectangular photos.
  Keep speaker portraits circular and video previews square-cornered. Logos retain
  their artwork; do not clip their visible marks.
- The program header is white at 94% opacity with 16px backdrop blur. Talk cards
  use a subtle 1px border and 8px backdrop blur.
- Keep the hand-drawn title strokes in their section's established blue or black.
- Align sponsor and organizer logos optically using their visible artwork,
  including internal whitespace. Keep tiers visibly distinct; organizer logos
  are comparable to platinum sponsors.
- Reuse `background/` and `assets/waves.*` for the wave background rather than
  creating another animation. Respect reduced-motion preferences and keep motion
  behind readable content.
- Use [the static wave artwork](assets/images/brand/grey-waves-wallpaper.png)
  when a still background is needed. Keep the supplied image's colors and blur.

## Asset structure

```text
assets/
  images/brand/         Year-neutral MQSF logos, PNG exports, favicon, backdrop
  fonts/                Poppins files and their license
  waves.css, waves.js   Shared wave presentation
logos/                  Public logo previews and download links
2026/
  assets/event/         Dated branding, event photos, thumbnails, social artwork
  assets/sponsors/      Individual sponsor PNGs and sponsorwall originals
  assets/organizers/    Organizer logos
  assets/speakers/      Portraits and their source artwork
  materials/           Posters and other event downloads
```

Use the same edition structure for future years. Keep each edition's sponsor
roster and artwork within that year; do not overwrite archived assets. Use
descriptive lowercase filenames and extensions matching the actual format for
new artwork. Keep individual sponsor logos in PNG format. Retain source files
and avoid recompressing images during moves.
Links should be relative so both production and PR previews work.

## Review before publishing

Check the page at narrow widths, with keyboard navigation, and with reduced
motion enabled. Review text enlargement to 200% and page reflow at 320 CSS pixels,
including expanded talks and calendar dialogs. Keep keyboard focus visible and
touch targets large enough to use; generally at least 24×24 CSS pixels, with
larger controls preferred for touch.

These checks follow W3C guidance for
[text enlargement](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html),
[reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
[focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html), and
[target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Run the repository's existing link, packaging, and calendar checks; review the
PR preview before merging.
