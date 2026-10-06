# Automated checks and PR previews

The `Website checks and previews` workflow runs `npm test` and the Python API
checks for PRs and pushes to `main`. Tests use temporary databases, never D1
production data. No new application dependencies or frontend framework are needed.

After checks pass, the workflow packages only tracked public pages and assets.
The downloadable `website` artifact is available even when publishing is disabled
or the PR comes from a fork.

## Enable publishing once, after merging

Merge the year-based restructuring first, then this PR. Publishing is initially
disabled so a PR cannot change the current live hosting configuration.

1. In **Settings → Pages**, change **Source** to **GitHub Actions**.
2. In **Settings → Environments → github-pages**, allow deployments from `main`
   and PR merge refs (`refs/pull/*/merge`). Keep any required-reviewer protection
   you want for publishing. PRs from forks are never published by this workflow.
3. In **Settings → Secrets and variables → Actions → Variables**, create
   `ENABLE_SITE_PREVIEWS` with value `true`.
4. Run **Actions → Website checks and previews → Run workflow** on `main` once.
   This seeds `gh-pages` with the production site and deploys it. Until this first
   production run succeeds, PR publishing is skipped to avoid a preview-only root.
5. Open or update an internal PR. Its comment links to
   `<Pages base>/previews/pr-<number>/`. Closing or merging the PR removes its
   preview and updates the comment. Existing PRs need a new event/rerun to publish.

The workflow uses only the repository-provided token: no personal token, SSH key,
Cloudflare secret, or new hosting account. The publishing job needs contents,
Pages, OIDC, and PR-comment write permissions. The test job has read-only repository
access. Organization policies may require an administrator to approve these permissions.

## How production and previews coexist

`gh-pages` stores the production root plus `previews/pr-N/` directories.
Production updates clean the root while preserving previews; PR updates and cleanup
touch only their own directory. Publishing is serialized, and stale head revisions
are skipped. The complete combined directory is deployed with the official Pages
action because token-generated branch commits do not trigger branch-based Pages builds.

Do not select `gh-pages` as a branch publishing source or edit it manually. It is
generated storage, not source code. Website content still lives on `main`.

## Preview safety and limitations

- Previews are public and share the production Pages origin. Only trusted,
  same-repository PRs publish; fork PRs get tests and a downloadable artifact only.
  This is not an isolation boundary for untrusted JavaScript.
- Preview packaging replaces the calendar configuration with a preview flag.
  The client returns an empty, labelled calendar without making API requests.
  Creating, editing, deleting, and organizer sign-in are rejected as read-only.
  Use the existing local demo for full interactive calendar testing.
- Preview HTML has `noindex, nofollow`. This discourages indexing, not access.
- Production configuration, API behavior, database, and deployment remain unchanged
  apart from publishing the same static site through Actions.
- Setting `ENABLE_SITE_PREVIEWS` to `false` stops **all** publishing, including
  production updates and preview cleanup; checks continue. Existing pages stay live.
- The first deployment and remote cleanup require the one-time settings above;
  local tests cannot prove GitHub environment authorization.

For local checks, use the commands in the [README](../README.md). To inspect the
exact static artifact, run `node .github/scripts/package-site.mjs /absolute/new/output`
(add `--preview` for a read-only preview), then serve that folder locally.
