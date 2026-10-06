# Year-based site migration

## This PR

Review and merge without renaming the repository. The published base stays
`https://munich-quantum-software.github.io/mqsf-2026-program/`.

| Entry point relative to the published base | Behavior after merging |
| --- | --- |
| `/` or `/index.html` without a fragment | Opens the 2026 event landing page |
| `/#day-1`, `/#day-2`, `/#side-events`, `/#organizer`, `/#sponsors` | Opens the same section in `/2026/program/` |
| `/event-preview/` | Opens `/2026/`, preserving fragment and query |
| `/side-events/` | Opens `/2026/program/#side-events` |
| `/background-preview/` | Opens `/background/` |

The old bare program URL now opens the event landing page; its **full program**
link leads to `/2026/program/`. Redirect pages use JavaScript to retain fragments
and query parameters, with ordinary links available when JavaScript is disabled.
They are not HTTP 301/302 redirects. Old direct asset/download URLs are not
redirected; update any externally shared downloads to `/2026/materials/`.

The existing Squarespace `/mqsf` mapping to `/event-preview/` continues to work.
After verifying the deployment, it can point directly to the repository root:

```text
/mqsf -> https://munich-quantum-software.github.io/mqsf-2026-program/ 302
```

The database, Worker name, production API URL, secrets, and permissions are
unchanged. The Worker imports conference settings from their new location;
subsequent deployments use the same existing database. No data migration or
Worker redeploy is required for this path-only frontend change.

## Optional later rename to `mqsf`

GitHub repository redirects do **not** redirect GitHub Pages URLs. Do not rename
until redirects for already-shared website URLs are ready.

1. Rename the repository, update the local Git remote, and verify GitHub Pages
   at `https://munich-quantum-software.github.io/mqsf/`.
2. Provide a small legacy Pages site at the old repository name. Its old root
   must forward to the **2026 program**, while its `event-preview/`,
   `side-events/`, and `background-preview/` paths forward to their respective
   new locations. Preserve fragments and queries. Do not clone the full site.
3. Update the Squarespace URL mapping only after the new destination works:

   ```text
   /mqsf -> https://munich-quantum-software.github.io/mqsf/ 302
   ```

4. Verify program day links, meet-ups, organizer sign-in, background, images,
   videos, and downloadable materials on desktop and mobile.

The GitHub Pages origin stays `https://munich-quantum-software.github.io`, so a
repository-path rename does not require a calendar CORS change. Moving to a
custom domain would require reviewing the allowed origins separately.

References: [GitHub repository renames](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
and [Squarespace URL mappings](https://support.squarespace.com/hc/en-us/articles/205815308-URL-mappings).
