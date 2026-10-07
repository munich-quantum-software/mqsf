# Year-based site migration

## Breaking URL changes

This PR intentionally removes old page aliases. After merging:

| Content | Path relative to the published repository base |
| --- | --- |
| Current edition | `/` (opens `/2026/`) |
| 2026 event page | `/2026/` |
| 2026 program | `/2026/program/` |
| Meet-ups | `/2026/program/#side-events` |
| Organizer sign-in | `/2026/program/#organizer` |
| Standalone animation | `/background/` |
| Event poster | `/2026/materials/mqsf_2026_save_the_date-2whd.pdf` |

`/event-preview/`, `/side-events/`, and `/background-preview/` are removed.
Old root fragments such as `/#day-2` no longer route to the program.
Previously shared direct asset URLs also change. Update published links and
bookmarks; no compatibility site or redirects are included.

## Squarespace cutover

The existing mapping to `/event-preview/` will stop working after deployment.
Coordinate the merge with this replacement mapping:

```text
/mqsf -> https://munich-quantum-software.github.io/mqsf-2026-program/ 302
```

The root opens the current edition without JavaScript. Future editions only
require changing the root refresh destination and link, not Squarespace.

## Optional repository rename

This PR does not rename the repository. If it is later renamed to `mqsf`,
verify GitHub Pages at the new address and change the Squarespace mapping to:

```text
/mqsf -> https://munich-quantum-software.github.io/mqsf/ 302
```

Update the local Git remote and any shared GitHub Pages links as well.
GitHub repository redirects do **not** redirect GitHub Pages URLs; without a
legacy site, all old repository-based website URLs will stop working.

## Calendar and validation

The production database, Worker name, API URL, secrets, and permissions remain
unchanged. Existing API compatibility is outside this website-route cleanup.
The Worker imports its unchanged 2026 settings from the new location; no data
migration or Worker redeploy is required for this frontend reorganization.

A repository rename does not change the GitHub Pages origin, so it does not
require a calendar CORS change. A custom domain would require reviewing allowed
origins separately.

Before cutover, verify the event page, program, meet-ups, organizer sign-in,
animation, images, videos, and downloads. The PR itself neither merges nor
changes Squarespace settings.

References: [GitHub repository renames](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
and [Squarespace URL mappings](https://support.squarespace.com/hc/en-us/articles/205815308-URL-mappings).

## Corporate identity asset folders

The event and program URLs stay the same. The shared logo page is at `/logos/`.
Direct links to edition sponsor and organizer artwork must use the new folders:

| Old path within `2026/assets/` | New path within `2026/assets/` |
| --- | --- |
| `event/aws.png` | `sponsors/aws.webp` |
| `event/classiq.png` | `sponsors/classiq.webp` |
| `event/HPE.png` | `sponsors/hpe.webp` |
| `event/planqc.png` | `sponsors/planqc.webp` |
| `event/neQxt-logo-large-size.png` | `sponsors/neqxt.webp` |
| `event/quandela.jpg` | `sponsors/quandela.webp` |
| `event/qudora_long_black-768x291.png` | `sponsors/qudora.webp` |
| `event/Xanadu-Logo---Landscape.png` | `sponsors/xanadu.webp` |
| `event/infineon.png` | `sponsors/infineon.webp` |
| `event/IQM-Logo-black.png` | `sponsors/iqm.webp` |
| `event/PsiQuantum-Black-Digital.png` | `sponsors/psiquantum.webp` |
| `event/quantinuum.png` | `sponsors/quantinuum.webp` |
| `event/quera.png` | `sponsors/quera.webp` |
| `event/mqsc.png` | `organizers/mqsc.webp` |
| `event/tum.png` | `organizers/tum.webp` |
| `event/mqv.png` | `organizers/mqv.webp` |
| `sponsorwall.png` | `sponsors/sponsorwall.png` |
| `sponsorwall.svg` | `sponsors/sponsorwall.svg` |

The moved files retain their original bytes. The individual logos were already
WebP files; their extensions now match their contents. Update external embeds
that use the old direct asset URLs. No Worker, database, or Squarespace change is
needed for these asset moves.
