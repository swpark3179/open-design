# FabriX (Samsung SDS) BYOK — fork integration note

This fork adds **Samsung SDS FabriX** as a BYOK provider. The feature is built as a
self-contained "addon seam": almost all logic lives in dedicated `fabrix/` modules,
and the edits to shared files are small and additive so the change **re-applies cleanly
when bumping to a future Open Design patch version**.

This file is the re-application checklist. When you rebase/upgrade and a shared file
conflicts, re-apply the marked edit and verify with `pnpm --filter @open-design/web
typecheck` + `pnpm --filter @open-design/daemon typecheck`.

## Requirement source

`requirement.txt` (repo root) is the product spec. Key points:

- 3 fields entered **in order**: Endpoint URL → `x-fabrix-client` → `x-openapi-token`.
- After all three: a "fetch models" button appears → enables the model combobox.
- Combobox shows name + brief description + capability tag derived from `types`
  (TEXT = text-only, I2T = text+image-analysis, T2I = image-generation).
- FabriX is **first** in every BYOK provider list and the **default** BYOK provider.
- All FabriX calls are **forced non-proxy**.
- Credentials persist under `~/.open-design/fabrix.json`; the two secrets are **never**
  returned to the browser once stored (the UI shows a masked placeholder).
- Chat routes text vs. multipart by the selected model's capability type.

## New files (addon — drop back in wholesale)

| File | Role |
| --- | --- |
| `packages/contracts/src/api/fabrix.ts` | Shared DTOs (`FabrixPublicConfig`, model info, requests). Secrets never appear in the public shape. |
| `apps/daemon/src/fabrix/config.ts` | Persistence at `~/.open-design/fabrix.json` (`OD_FABRIX_CONFIG_DIR` for tests), `deriveModelKind`, `pickDefaultModels`, `toPublicConfig` masking. |
| `apps/daemon/src/fabrix/client.ts` | Upstream calls (all-models / messages / message-with-models). **Forced non-proxy** via a plain undici `Agent` dispatcher. SSE parsing + multipart form. |
| `apps/daemon/src/fabrix/routes.ts` | `GET/PUT /api/fabrix/config`, `POST /api/fabrix/models/fetch`, `POST /api/fabrix/select-model`, `POST /api/proxy/fabrix/stream` (routes text vs multipart by model kind). |
| `apps/web/src/fabrix/fabrix.ts` | Web-side daemon API client + label helpers + `FABRIX_MANAGED_API_KEY` sentinel + `fabrixModelsCacheKey`. |
| `apps/web/src/components/FabrixByokSection.tsx` | The 3-field settings panel + fetch button + capability-tagged model combobox. |
| `apps/web/src/providers/fabrix-compatible.ts` | Chat entry → `streamProxyEndpoint('/api/proxy/fabrix/stream', …)`. |

## Modified shared files (re-apply these small edits)

| File | Edit |
| --- | --- |
| `packages/contracts/src/index.ts` | `export * from './api/fabrix.js';` |
| `packages/contracts/src/api/connectionTest.ts` | Add `'fabrix'` to `ConnectionTestProtocol` (type-alignment only; FabriX uses its own routes). |
| `apps/daemon/src/server.ts` | `import { registerFabrixRoutes }` + call `registerFabrixRoutes(app, { projectsRoot: PROJECTS_DIR })`. |
| `apps/web/src/types.ts` | Add `'fabrix'` (first) to the `ApiProtocol` union. |
| `apps/web/src/state/apiProtocols.ts` | Add the `fabrix` entry to all 5 `Record<ApiProtocol, …>` maps + put it **first** in `API_PROTOCOL_TABS`; label `Samsung SDS FabriX`. |
| `apps/web/src/utils/apiProtocol.ts` | Add `fabrix` to `API_PROTOCOL_LABELS` + `API_PROTOCOL_AGENT_IDS`. |
| `apps/web/src/state/config.ts` | `DEFAULT_CONFIG.apiProtocol: 'fabrix'` (default BYOK provider, requirement #1). |
| `apps/web/src/components/SettingsDialog.tsx` | Import + render `<FabrixByokSection>` when `apiProtocol === 'fabrix'`; add `fabrix` to `API_KEY_CONSOLE_LINKS`; add `fabrix` to the model-fetch effect's skip list. |
| `apps/web/src/components/InlineModelSwitcher.tsx` | `fabrix` first in the local tabs array; add `fabrix` to the generic provider-models fetch skip. |
| `apps/web/src/components/AvatarMenu.tsx` | Add `fabrix` to the generic provider-models fetch skip (work-screen picker — must match InlineModelSwitcher). |
| `apps/web/src/components/MemoryModelInline.tsx` | Map `fabrix` → `null` / model-inferred provider (it can't drive the generic memory path). |
| `apps/web/src/providers/anthropic.ts` | First branch of `streamMessage`: route `'fabrix'` to `streamMessageFabrix`. |
| `apps/web/src/App.tsx` | `loadFabrixConfig()` hydration on mount + on `FABRIX_CONFIG_CHANGED_EVENT`; persist model picks via `selectFabrixModel`. |
| `apps/web/tests/state/config.test.ts` | Default-protocol assertion expects `'fabrix'`. |

### Why these specific shared files

Adding `'fabrix'` to the `ApiProtocol` union forces TypeScript to demand an entry in
every `Record<ApiProtocol, …>` — that is what drives most of the edits above, and it is
also the safety net: **a missed map entry fails `typecheck` loudly**, so a re-apply that
compiles is a re-apply that covered the exhaustive maps. The non-exhaustive edits (the
`streamMessage` dispatch branch, the two model-switcher skips, and the App hydration) are
the ones to double-check by hand, since the compiler can't catch a missing `if`.

## Verify after re-applying

```bash
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/web test -- run state/config.test.ts
```

Manual smoke: Settings → switch to API mode → FabriX tab is pre-selected → enter the
three values → "fetch models" → pick a model → confirm it appears in the home top-right
and work-screen top-right pickers and that a chat request streams.
