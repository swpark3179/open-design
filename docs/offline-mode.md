# Offline / intranet mode (fork-specific)

This fork targets deployments where the running app may only reach the local
network and GitHub Enterprise — never the public internet. Build/packaging
machines may still be online; only the *deployed runtime* is restricted.

Offline mode is **on by default**. Set `OD_OFFLINE=0` (or `false`/`no`/`off`)
in the daemon/desktop environment to restore upstream online behavior.

## What offline mode gates

Single switch: `apps/daemon/src/offline-mode.ts` (`isOfflineMode()`).

| Surface | Upstream behavior | Offline behavior |
| --- | --- | --- |
| GitHub star badge (`/api/github/open-design`) | daemon fetches `api.github.com` hourly | daemon answers `204`; web hides the badge (`useGithubStars` → `GithubStarBadge`) |
| Release check (`/api/github/open-design/releases/latest`) | daemon fetches `api.github.com` | daemon answers `204`; web `fetchLatestGithubReleaseInfo` resolves `null` |
| Discord presence (`/api/community/discord`) | daemon fetches `discord.com/api` | daemon answers `204`; web stops asking (`useDiscordPresence`) |
| PostHog (daemon + web + error tracking) | enabled when `POSTHOG_KEY` set | `readPosthogConfig` returns `null` → daemon NOOP service, `/api/analytics/config` reports disabled, posthog-js never initializes |
| Langfuse / telemetry relay | enabled via `OPEN_DESIGN_TELEMETRY_RELAY_URL` or `LANGFUSE_*` keys | `readTelemetrySinkConfig` / object-relay resolution return `null` |
| Desktop auto-update (`releases.open-design.ai`) | enabled by default for packaged builds | default **disabled** (`resolveDesktopUpdaterConfig` in `apps/desktop/src/main/updater.ts`); opt back in with `OD_UPDATE_ENABLED=1` + `OD_UPDATE_METADATA_URL` pointing at an internal mirror |
| Plugin preview bakes | fall back to R2 CDN (`repo-assets.open-design.ai`) | no R2 fallback; gallery uses the live-iframe path unless clips are on disk or `OD_PLUGIN_PREVIEWS_BASE_URL` is set |
| Plugin `od.preview` media (`cdn.jsdelivr.net/gh/...`) | loaded straight from jsdelivr | rewritten at list time to `/api/plugins/:id/asset/<rel>` (`localizePluginPreviewMedia`) — the files ship inside each plugin folder |
| Plugin install of official `github:` sources | `codeload.github.com` tarball | resolved from the local bundle (workspace checkout or packaged resource root); see `localSourceRoots` in `apps/daemon/src/plugins/installer.ts`. `plugins/community` is now bundled by `tools/pack` as well |
| Community pet sync (`supabase.co`, `j20.nz`) | downloads catalogs | returns a zero-work result with an explanatory error; bundled pets keep working |

## Vendored CDN assets (`/vendor`)

Generated artifacts and design templates no longer reference public CDNs.
The repo ships the libraries under `vendor/` (see `vendor/README.md` for the
exact provenance list), the daemon serves them at `/vendor`, the web dev
server (`next.config.ts` rewrite) and the packaged web sidecar
(`apps/web/sidecar/server.ts`) proxy `/vendor/*` to the daemon, and
`tools/pack` bundles the tree into the packaged resource root.

Rewritten references (system prompts, `skills/`, `design-templates/`,
`design-systems/`, `plugins/`, web/daemon template strings):

- `https://cdn.tailwindcss.com` → `/vendor/tailwindcss/tailwindcss.js`
- `https://unpkg.com/<pkg>` and `https://cdn.jsdelivr.net/npm/<pkg>` → `/vendor/npm/<pkg>` (chart.js 4.4.0/4.4.3 normalized to 4.4.7)
- `https://picsum.photos/...` → `/vendor/placeholder/...` — a daemon route that renders a deterministic SVG gradient (`/vendor/placeholder/seed/:seed/:w/:h` and `/vendor/placeholder/:w/:h`)

The official system prompt (`apps/daemon/src/prompts/official-system.ts`,
mirrored in `packages/contracts/src/prompts/official-system.ts`) now tells the
model the deployment is offline and lists the local equivalents.

## Known remaining external references (accepted)

- **Google Fonts in design templates** (`fonts.googleapis.com` across ~200
  template/example files): left in place — browsers fall back to system fonts
  when the host is unreachable, and the system prompt steers newly generated
  artifacts toward system font stacks. The app UI's own Google Fonts import
  (Cairo in `apps/web/src/index.css`) was removed.
- **User-clicked hyperlinks** (GitHub/Discord/X links in menus, design-browser
  gallery links): not auto-fetched; they simply fail to open externally.
- **User-configured integrations**: AI providers (BYOK endpoints, agent CLIs,
  media generation), Vercel/Cloudflare deploy, Composio connectors, marketplace
  `add`/`refresh` of remote URLs, and design-system GitHub imports stay
  untouched per deployment policy — they are opt-in, fail gracefully, and can
  be pointed at internal hosts (`OD_MARKETPLACE_REGISTRY_BASE_URL`,
  `OD_MARKETPLACE_REPO`, provider base-URL overrides) including GitHub
  Enterprise.

## Re-applying after an upstream bump

The change set is anchor-based and concentrated in:
`apps/daemon/src/offline-mode.ts` (new), `analytics.ts`, `langfuse-trace.ts`,
`langfuse-bridge.ts`, `server.ts`, `community-pets-sync.ts`,
`plugin-preview-bakes.ts`, `plugins/installer.ts`, `prompts/official-system.ts`,
`tools-connectors-cli.ts`, `design-systems.ts`;
`packages/contracts/src/prompts/official-system.ts`;
`apps/web` (`useGithubStars`, `GithubStarBadge`, `useDiscordPresence`,
`index.css`, `runtime/react-component.ts`, `DesignSystemFlow.tsx`,
`next.config.ts`, `sidecar/server.ts`);
`apps/desktop/src/main/updater.ts`; `tools/pack/src/resources.ts` +
`win/resources.ts`; plus the mechanical CDN→`/vendor` rewrite over content
directories and the committed `vendor/` tree.
