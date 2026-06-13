# Locally-vendored CDN assets (offline / intranet builds)

This tree replaces the public CDN references that generated artifacts and
design templates used to load at view time (`cdn.tailwindcss.com`,
`unpkg.com`, `cdn.jsdelivr.net`). The daemon serves it at `/vendor` (see
`apps/daemon/src/server.ts`), the web dev server and the packaged web sidecar
proxy `/vendor/*` through to the daemon, and `tools/pack` bundles the tree
into the packaged resource root.

URL mapping convention:

- `https://cdn.jsdelivr.net/npm/<pkg>@<ver>/<path>` → `/vendor/npm/<pkg>@<ver>/<path>`
- `https://unpkg.com/<pkg>@<ver>/<path>` → `/vendor/npm/<pkg>@<ver>/<path>`
- `https://cdn.tailwindcss.com` → `/vendor/tailwindcss/tailwindcss.js`
- `https://picsum.photos/seed/<seed>/<w>/<h>` → `/vendor/placeholder/seed/<seed>/<w>/<h>`
  (served by a daemon route that renders a deterministic SVG, not from this tree)

Current contents and where each file was downloaded from (2026-06-11):

| Local path | Source URL |
| --- | --- |
| `tailwindcss/tailwindcss.js` | https://cdn.tailwindcss.com/3.4.16 |
| `npm/react@18.3.1/umd/react.development.js` | https://unpkg.com/react@18.3.1/umd/react.development.js |
| `npm/react-dom@18.3.1/umd/react-dom.development.js` | https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js |
| `npm/@babel/standalone@7.29.0/babel.min.js` | https://unpkg.com/@babel/standalone@7.29.0/babel.min.js |
| `npm/framer-motion@11.11.13/dist/framer-motion.js` | https://unpkg.com/framer-motion@11.11.13/dist/framer-motion.js |
| `npm/gsap@3.14.2/dist/gsap.min.js` | https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js |
| `npm/chart.js@4.4.7/dist/chart.umd.min.js` | https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js (4.4.0/4.4.3 refs were normalized to 4.4.7) |
| `npm/hls.js@1.5.13/dist/hls.min.js` | https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js |
| `npm/lucide@latest/dist/umd/lucide.min.js` | https://unpkg.com/lucide@latest/dist/umd/lucide.min.js (snapshot of `latest` at vendoring time) |
| `npm/highlight.js@11.10.0/lib/core.min.js` | https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/core.min.js |
| `npm/highlight.js@11.10.0/lib/languages/javascript.min.js` | https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/lib/languages/javascript.min.js |
| `npm/highlight.js@11.10.0/styles/tokyo-night-dark.min.css` | https://cdn.jsdelivr.net/npm/highlight.js@11.10.0/styles/tokyo-night-dark.min.css |
| `npm/@phosphor-icons/web@2.1.1/src/regular/style.css` (+ `Phosphor.woff2/.woff/.ttf/.svg`) | https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/ |
| `npm/@tabler/icons@latest/icons/arrow-right.svg` | https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/arrow-right.svg |

To refresh or add an asset, download it on a machine with internet access at
build time, keep the `npm/<pkg>@<ver>/<path>` layout, and update the matching
references in `apps/daemon/src/prompts/official-system.ts`,
`packages/contracts/src/prompts/official-system.ts`, and the
`design-templates/` / `skills/` HTML files.

Files under this tree are vendored third-party runtime assets; the repo guard
(`scripts/guard.ts`) allowlists `vendor/` for residual JavaScript.
