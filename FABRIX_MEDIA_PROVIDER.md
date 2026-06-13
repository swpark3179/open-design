# FabriX (Samsung SDS) media provider — image generation + analysis

This note documents the change that promotes **Samsung SDS FabriX** from a
chat-only BYOK provider into a first-class **media provider** for the
image/video media-generation feature. It is written so the change can be (a)
re-applied cleanly after an Open Design version bump, and (b) lifted into a
reusable skill ("add a BYOK image media provider").

It builds directly on the chat-side integration documented in
[`FABRIX_INTEGRATION.md`](./FABRIX_INTEGRATION.md) — read that first. The media
bridge **reuses the same FabriX client and credential store**; it does not
introduce a second credential surface.

## What the user gets

- FabriX appears as a media provider for the **image** surface, reachable from
  both surfaces required by the dual-track rule (UI **and** CLI):
  - **UI**: the New Project image picker lists the user's FabriX image-capable
    models (discovered live), grouped under "Samsung SDS FabriX".
  - **CLI**: `od media generate --surface image --model "fabrix:<modelId>" …`.
- Two capabilities, chosen automatically by the selected model's FabriX
  capability `types`:
  - **T2I (image generation)** → a PNG written into the project.
    ```bash
    od media generate --surface image --model "fabrix:<t2i-model-id>" \
      --prompt "강아지 그려줘" --aspect 1:1 --output dog.png
    ```
  - **I2T (image analysis)** → the model's text answer written as a Markdown
    (`.md`) artifact. Requires a reference image.
    ```bash
    od media generate --surface image --model "fabrix:<i2t-model-id>" \
      --image ref.png --prompt "이 이미지를 분석해줘" --output analysis.md
    ```

## Design at a glance

| Concern | Decision | Why |
| --- | --- | --- |
| Credentials | Read from the existing FabriX store `~/.open-design/fabrix.json`, **not** `media-config.json`. | FabriX uses a 3-field secret shape (endpoint + `x-fabrix-client` + `x-openapi-token`), incompatible with the media `apiKey/baseUrl/model` shape. One source of truth, no double entry. |
| Settings surface | Media provider is `settingsVisible:false`, `credentialsRequired:false`. | Creds are entered in the FabriX **API-mode** panel (`FabrixByokSection`). The media picker treats FabriX as always-ready; the renderer throws a clear "not configured" error if the store is empty. |
| Model ids | `fabrix:<modelId>` prefix; **catalog-bypass** (not in the static registry). | FabriX models are per-user and dynamic, exactly like the AIHubMix `aihubmix-*` precedent. The prefix is stripped to the real id inside the renderer. |
| Transport | Reuses `fabrix/client.ts` (`generateFabrixImage`, `streamFabrixImageAnalysis`). | The client already forces a **non-proxy** dispatcher (an on-prem gateway requirement); the media proxy dispatcher is intentionally ignored on this path. |
| Surfaces | Image only. Video/audio rejected with a clear message. | The FabriX samples cover T2I + I2T only. |
| Analysis output | Markdown `.md` (`kindFor('.md') === 'text'`). | The media framework is byte/extension-agnostic; `suggestedExt` swaps `.png`→`.md` so the FileViewer renders the analysis as text. |

Routing rule (in `renderFabrixMediaImage`): the stored model's `kind`
(`deriveModelKind(types)`) decides T2I vs I2T. When the id isn't cached yet, the
presence of `--image` implies analysis, otherwise generation.

## Files

### New
| File | Role |
| --- | --- |
| `apps/web/src/media/fabrix-media-models.ts` | Live FabriX image-model hook + merge helper for the picker (mirrors `aihubmix-image-models.ts`). |
| `apps/daemon/tests/media-fabrix.test.ts` | T2I generation, I2T analysis, non-image rejection, unconfigured-store error. |

### Modified (small, additive — the re-application checklist)
| File | Edit |
| --- | --- |
| `apps/daemon/src/media-models.ts` | Add the `fabrix` entry to `MEDIA_PROVIDERS` (`integrated:true`, `credentialsRequired:false`, `settingsVisible:false`). No static models — they're discovered live. |
| `apps/daemon/src/media.ts` | Import `fabrix/config` + `fabrix/client`; add the `FABRIX_MEDIA_PREFIX` const; add the `fabrix:` catalog-bypass branch (image-only); add `renderFabrixMediaImage` + `collectFabrixAnalysis` + `fabrixAspectToSize`; add the `def.provider === 'fabrix' && surface === 'image'` dispatch branch. |
| `apps/daemon/src/media-routes.ts` | Import `readFabrixConfig`; add `GET /api/media/providers/fabrix/models` (returns T2I+I2T models as `fabrix:<id>`, local-origin gated). |
| `apps/web/src/media/models.ts` | Add `'fabrix'` to `MediaProviderId`; add the matching `MEDIA_PROVIDERS` entry; add the `fabrix:` namespace to `mediaModelProviderId`. |
| `apps/web/src/media/provider-readiness.ts` | Resolve dynamic prefixed ids (`aihubmix-*`, `fabrix:*`) via `mediaModelProviderId` so they aren't falsely gated as "not ready". |
| `apps/web/src/components/NewProjectPanel.tsx` | Import + call `useFabrixImageModels`; merge into the image picker; add `'fabrix'` to `supportedModels`' image provider set; accept `fabrix:` ids in the prompt-template round-trip. |

The TypeScript union edit (`MediaProviderId`) is the safety net: a missed
consumer fails `pnpm --filter @open-design/web typecheck` loudly. The daemon
`MediaProvider.id` is a plain `string`, so the dispatch branch and renderer are
the hand-checked, non-exhaustive parts.

> No `scripts/verify-media-models.mjs` impact: it diffs the model *arrays*
> (IMAGE/VIDEO/AUDIO), not `MEDIA_PROVIDERS`. We add a provider, not static
> models, so the daemon↔web drift check stays green.

## Generalized recipe — "add a BYOK image media provider"

1. **Provider registration** (both registries): add the id to
   `MEDIA_PROVIDERS` in `apps/daemon/src/media-models.ts` and
   `apps/web/src/media/models.ts`, plus the `MediaProviderId` union. If
   credentials live in a non-media store, set `settingsVisible:false` +
   `credentialsRequired:false`.
2. **Id namespace**: pick a unique prefix (`<provider>:` or `<provider>-`) and
   teach `mediaModelProviderId` (web) about it. Add a catalog-bypass branch in
   `generateMedia` so the dispatcher synthesizes a def instead of throwing
   "unknown model".
3. **Renderer**: add a `render<Provider>…` function returning
   `{ bytes, providerNote, suggestedExt }`, and one `def.provider === … &&
   surface === …` dispatch branch. Reuse an existing client if there is one.
4. **Live discovery**: add `GET /api/media/providers/<id>/models` (local-origin
   gated) + a web hook/merge helper, and wire it into the picker.
5. **Readiness**: make `provider-readiness.ts` resolve the dynamic prefix.
6. **Tests**: cover each capability path + the unconfigured/invalid-surface
   error paths in `apps/daemon/tests/`.

## Verify after changes

```bash
node scripts/verify-media-models.mjs
pnpm --filter @open-design/daemon typecheck
pnpm --filter @open-design/web typecheck
pnpm --filter @open-design/daemon test media-fabrix
pnpm guard
```

Manual smoke: configure FabriX in Settings → API mode → fetch models → New
Project → Image → confirm FabriX models appear in the picker; then
`od media generate --surface image --model "fabrix:<id>" --prompt "…"` and
confirm the artifact is written and previews in the FileViewer.
