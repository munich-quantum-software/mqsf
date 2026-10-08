# MQSF corporate identity

MQSF is clear, calm, and technical: generous space, readable type, blue accents,
and the navy wave. These rules apply to every page and future edition.
The single source of design values is [assets/brand.css](assets/brand.css).
Load it before page styles; page styles own layout, not a separate visual identity.
Component-specific dimensions belong in their styles, not in these identity rules.

## 1. One type system

Use local **Poppins** from `assets/fonts/` (SIL OFL, `OFL.txt`).

| Role | Desktop | Mobile ≤700px | Weight |
| --- | --- | --- | --- |
| Section headings and prominent text | 28px | 16px | 500 for headings; 300 for text |
| Body prose, form inputs and compact UI headings | 16px | 16px | 300; UI headings 500 |
| Navigation, buttons and supporting details | 14px | 14px | 500 for controls; 300 for text |

Use 700 only for explicit emphasis. Use `rem` sizes so browser text enlargement
works. Body line height is **1.6**, heading line height **1.3**, with normal letter
spacing for prose and headings. Keep semantic heading levels; do not invent extra sizes for hierarchy.
Left-align prose. Center only section titles, hero branding, and logo groups.

## 2. One palette, two surface recipes

| Role | Light surfaces | Dark surfaces |
| --- | --- | --- |
| Background | White `#fff` | Navy `#17213c` |
| Main text | Charcoal `#3d3d3c` | White `#fff` |
| Muted text | `#5f6a78` | `#b2c1d4` |
| Links and accents | Brand blue `#006fb7` | Light blue `#6ac0f2` |
| Divider | `#dbe2ea` | White at 20% opacity |
| Panel | White; alternating sections `#f3f5f8` | Navy at 88% opacity |

Primary buttons are always brand blue with white text. Secondary buttons are
white with blue text and a blue border. Do not use brand blue for small text on
navy. Status colors and third-party artwork are functional exceptions, not new
brand colors. Use the surface's palette regardless of which page contains it.

Section headings follow the surface: white uses black (`#000`) with a blue
underline stroke; gray uses blue with a black stroke; navy uses light blue.
Underline strokes are decorative, never the only indication of hierarchy.

## 3. One spacing and shape system

- Use **8, 16, 24, 32, 48, 64px** spacing: 8 within a control, 16 between related
  items, 24–32 inside panels, 48–64 between sections.
- Content width: **1160px** maximum. Outer gutters: **24px**, or **16px** on mobile.
- Section padding: **64px**, or **48px** on mobile. Panel padding: **32px**, or
  **24px** on mobile.
- Cards, rectangular photos, dialogs, and controls: **10px corners**, 1px borders.
  Portraits stay circular; videos stay square-cornered. Logos and icons retain
  their source shapes: never add rounding, crop, or stretch them.
- Content boxes use `var(--surface)` with a **1px solid `var(--line)` border**:
  `#dbe2ea` on light surfaces, white at 20% opacity on dark surfaces. Choose the
  border palette for the box's surface, not the artwork behind it. Use the same
  **10px corners** on plain and wave backgrounds.
- Buttons: **44px** minimum height, 8px/16px padding, 14px type, weight 500.
  Focus: 3px accent outline, 3px offset. Do not rely on hover alone.
- Light glass surfaces use white at **94% opacity** with **16px blur**.
  Keep content readable over the surface beneath them.

## 4. Recognizable artwork, restrained motion

Use the full [MQSF logos](https://munich-quantum-software.github.io/mqsf/logos/)
in SVG or PNG: charcoal lettering on light backgrounds, white on dark.
Keep proportions and colors; clear space is at least one quarter of the symbol's
height. Use dated versions only for that edition. Match sponsor and organizer
logos by visible artwork, not canvas dimensions; keep sponsor tiers distinct.

Use restrained upward entrances for content and a coherent wave for animated
backgrounds. Reuse the shared `background/` implementation; respect reduced motion.
Use [the supplied static wave](assets/images/brand/grey-waves-wallpaper.png)
for still backgrounds. Do not recolor or add a second animated layer.

## 5. Keep assets and review simple

Year-neutral logos and backgrounds live in `assets/images/brand/`; shared fonts
in `assets/fonts/`. Each edition keeps `YEAR/assets/event/`, `sponsors/`,
`organizers/`, and `speakers/`, plus `YEAR/materials/`. Individual sponsor logos
are PNG. Preserve source artwork, use descriptive filenames and relative links,
and never overwrite an archived edition's assets.

Before publishing, review desktop and 320px mobile layouts, keyboard focus,
200% text enlargement, reduced motion, and interactive states, forms, and dialogs.
Run the existing checks. Verify text contrast over actual translucent surfaces.
These are design rules and review targets, not an accessibility certification.
Readability and accessibility follow [USWDS typography guidance](https://designsystem.digital.gov/components/typography/)
and [WCAG 2.2](https://www.w3.org/TR/WCAG22/); the MQSF tokens are our choices.
