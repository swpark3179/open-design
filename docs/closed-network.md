# Closed network mode (폐쇄망 모드)

**Siblings:** [`architecture.md`](architecture.md) · [`deployment/docker.md`](deployment/docker.md)

Closed network mode is for corporate intranets where the machine has general
internet access but specific hosts are blocked at the perimeter — typically
`github.com`, `api.github.com`, `*.github.io`, and the social networks.

Without it, an install on such a network still *works*, but it spends every
home activation timing out against blocked hosts, and it keeps offering actions
(share to X, publish a public link, install a plugin from GitHub) that cannot
possibly succeed there. The mode turns those calls off at the daemon boundary
and hides their entry points in the UI.

It is **not** an offline mode. Agent CLIs, BYOK/LLM providers, media
providers, MCP servers, connectors, and Figma are untouched — those are what the
product is for, and a blocked-GitHub network still reaches them.

## Turning it on

Put one file at the **top level of a project location** — the folder listed
under Settings → General → Project locations:

```
<project-location>/.open-design/closed-network.json
```

```json
{
  "schemaVersion": 1,
  "closedNetwork": true
}
```

Any configured project location works, including the daemon's built-in one. If
**any** of them carries the marker, the mode is on.

Or from the CLI:

```bash
od closed-network enable                    # default project location
od closed-network enable --location /work   # a specific one
od closed-network status --json
od closed-network disable
```

`OD_CLOSED_NETWORK=1` forces the mode on for a deployment with no project
location to drop a file into (containers, headless), and `OD_CLOSED_NETWORK=0`
forces it off. The env var always wins over the file.

**Restart required.** The mode is resolved once at daemon startup, like
`OD_SANDBOX_MODE`. Adding or removing the marker takes effect on the next
launch; the CLI prints a reminder.

**Verify it took.** Settings → About shows a read-only "Closed network mode"
row naming the source and the marker's path. There is no toggle: the mode is
provisioned by whoever administers the machine, and an in-app switch would offer
to undo an organization's network policy from inside the app.

## What it turns off

| Capability | Effect |
|---|---|
| `community-links` | GitHub / Discord / X / Threads / YouTube / Instagram / LinkedIn / Xiaohongshu links in the account menu, settings popover, help menu, chat feedback notes, and the file-panel tip ticker. The star-count and Discord-presence reads that fed them. The Electron **Help** menu's four outbound items (Export Diagnostics stays). |
| `social-share` | The share grid everywhere it mounts, the preview modal's own social row, and `POST /api/social-share` (403). |
| `external-publish` | Public file links, the Vercel/Cloudflare deploy modal, plugin "Publish repo" / "Open Design PR", and the plugin share menu's outbound anchors. Local exports (PDF, ZIP, HTML, Markdown, save-as-template) are untouched. |
| `home-external-content` | `api.github.com` star counts, `discord.com` presence, the hosted What's New document, plugin preview clips from the public CDN, and GitHub author avatars on plugin cards. |
| `telemetry` | PostHog, in both directions: the daemon's `posthog-node` client no-ops, and `/api/analytics/config` withholds the key and host so posthog-js, session replay, and the consent-bypassing exception beacon never initialize in the browser. The packaged shell's fatal-startup crash beacon is disarmed too. Install attribution is skipped. |
| `auto-update` | The `releases.open-design.ai` feed poll and its automatic download, plus the "view release notes" links that point at GitHub. |
| `plugin-marketplace` | Marketplace add/refresh (`raw.githubusercontent.com`), GitHub design-system import, remote skill installs, and community pet sync. **Local** installs — a folder, a ZIP, a `--location` path — keep working. |
| `message-center` | The AMR/Vela message center and its 60-second `amr-api.open-design.ai` poll. AMR sign-in, model discovery, and the API proxy stay live. |

## Keeping one of them

Organizations block different things. A site whose only problem is GitHub can
keep the updater, if its own mirror or the release origin is reachable:

```json
{
  "schemaVersion": 1,
  "closedNetwork": true,
  "allow": ["auto-update"]
}
```

`allow` accepts any capability name from the table above. Unknown names are
ignored, so a marker written for a newer build still parses on an older one.

## Deliberately left alone

- **Generated artifacts still reference `unpkg.com`.** The system prompt tells
  the agent to emit `<script src="https://unpkg.com/react@18…">`, and preview
  iframes load it. Changing that affects artifact quality for every user, so it
  belongs in its own change. `apps/daemon/src/inline-assets.ts` already has an
  inlining path if a follow-up wants it.
- **Workspace / team collaboration sharing.** It only appears once the user is
  signed into a workspace, which a closed network generally prevents anyway.
  Disabling it would break teams that do have intranet access to the hub.
- **Connectors (Composio), Figma, research, BYOK providers.** All opt-in, all
  configured explicitly by the user, none related to a blocked GitHub.
- **Brand logo prefetch.** User-initiated, and it may well be pointed at an
  internal URL. The favicon-service fallbacks already fail silently.
- **`POST /api/plugins/install`.** It serves both staged local uploads and
  remote sources through one path; refusing it wholesale would break local
  installs. The UI entry points for remote installs are hidden instead.

## Known limitations

- **One flash on the very first launch.** The renderer asks the daemon for the
  status and caches the answer, so it is correct from first paint on the second
  launch onward. The first launch after an operator drops the marker can briefly
  show a hidden surface. The daemon refuses the underlying calls regardless, so
  this is cosmetic.
- **No renderer CSP.** A `connect-src`/`img-src 'self'` policy on the Electron
  shell would also stop direct-from-browser requests. The desktop shell has no
  CSP at all today, so adding one has a wide blast radius and belongs in its own
  change.

## Changing this? Check Settings

Settings → About is the only surface that renders the status *object* rather
than asking `useClosedNetworkCapability` for a boolean, so it is the only screen
a malformed status can take down. Two rules keep that from happening again:

- Read the status through `useClosedNetworkStatus()` (which floors to the off
  state) and dereference it with optional chaining. Prefer the capability hook
  wherever a boolean is enough.
- Keep `apps/web/src/runtime/closed-network.tsx` free of runtime *value* imports
  from `@open-design/contracts`. Types only. That module is mounted in the root
  layout, so a resolution failure there would cost the app shell, not a badge.

`apps/web/tests/components/SettingsDialog.closedNetwork.test.tsx` pins both.

Verification for this feature is not complete without a **production** build:
`pnpm --filter @open-design/web build`, then open Settings and click through
every section with the flag both on and off. The jsdom suite renders Settings
without the provider mounted, so it cannot see this class of fault on its own.

## Implementation map

| Concern | Source |
|---|---|
| Marker path, schema, capability names, env parsing | `packages/contracts/src/api/closed-network.ts` |
| Daemon resolution at startup | `apps/daemon/src/closed-network.ts`, resolved in `apps/daemon/src/server.ts` |
| Status endpoint and the route guard | `apps/daemon/src/routes/closed-network.ts` |
| Packaged resolution + env propagation | `apps/packaged/src/closed-network.ts`, `apps/packaged/src/sidecars.ts` |
| Desktop updater and Help menu | `apps/desktop/src/main/closed-network.ts` |
| Renderer provider and the guard hook | `apps/web/src/runtime/closed-network.tsx` |
| CLI | `runClosedNetwork` in `apps/daemon/src/cli.ts` |
