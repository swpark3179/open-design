// FabriX (Samsung SDS) BYOK configuration panel.
//
// Renders in place of the generic BYOK form when the active protocol is
// `fabrix`. The flow follows the FabriX requirement exactly:
//   1. Enter, in order, Endpoint URL → x-fabrix-client → x-openapi-token.
//   2. Once all three are present a "Fetch models" button appears.
//   3. Fetching enables the model combobox below it and fills the list with
//      each model's name, a brief description, and a capability tag derived
//      from its `types` (text-only / text+image-analysis / image-generation).
//   4. Selecting a model auto-saves (daemon-side) and updates the home/work
//      top-bar model switchers via the config-changed event.
//
// Secrets are owned by the daemon (`~/.open-design/fabrix.json`) and are never
// echoed back here — when a value is already stored we show a masked
// placeholder and keep the input empty so the credential is not displayed.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AppConfig, ApiProtocolConfig } from '../types';
import {
  FABRIX_MANAGED_API_KEY,
  fabrixModelHasType,
  fabrixModelKindLabel,
  fetchFabrixConfig,
  fetchFabrixModelsFromDaemon,
  notifyFabrixConfigChanged,
  selectFabrixModel,
  setFabrixDefaultModels,
  type FabrixModelInfo,
  type FabrixPublicConfig,
} from '../fabrix/fabrix';

interface Props {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
}

// Project the FabriX selection onto the settings config so the BYOK gates and
// the (fabrix-active) top-level fields stay in sync. Only called while the
// active protocol is `fabrix`, so we always project to the top level too.
function applyFabrixToConfig(
  setCfg: Dispatch<SetStateAction<AppConfig>>,
  opts: { endpoint: string; model: string; configured: boolean },
): void {
  setCfg((prev) => {
    const apiKey = opts.configured ? FABRIX_MANAGED_API_KEY : '';
    const slot: ApiProtocolConfig = {
      apiKey,
      baseUrl: opts.endpoint,
      model: opts.model,
      apiProviderBaseUrl: null,
    };
    const next: AppConfig = {
      ...prev,
      apiProtocolConfigs: { ...(prev.apiProtocolConfigs ?? {}), fabrix: slot },
    };
    if ((prev.apiProtocol ?? 'anthropic') === 'fabrix') {
      next.apiProtocol = 'fabrix';
      next.apiKey = apiKey;
      next.baseUrl = opts.endpoint;
      next.model = opts.model;
      next.apiProviderBaseUrl = null;
      next.apiVersion = '';
    }
    return next;
  });
}

export function FabrixByokSection({ cfg, setCfg }: Props) {
  const [endpointUrl, setEndpointUrl] = useState('');
  const [clientInput, setClientInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [clientConfigured, setClientConfigured] = useState(false);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [models, setModels] = useState<FabrixModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [imageGenModelId, setImageGenModelId] = useState('');
  const [imageAnalysisModelId, setImageAnalysisModelId] = useState('');
  const [showSecrets, setShowSecrets] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedNotice, setFetchedNotice] = useState<number | null>(null);
  const loadedRef = useRef(false);

  const ingestConfig = useCallback(
    (config: FabrixPublicConfig) => {
      setEndpointUrl(config.endpointUrl ?? '');
      setClientConfigured(config.clientConfigured);
      setTokenConfigured(config.tokenConfigured);
      setModels(config.models ?? []);
      setSelectedModelId(config.selectedModelId ?? '');
      setImageGenModelId(config.defaultT2iModelId ?? '');
      setImageAnalysisModelId(config.defaultI2tModelId ?? '');
      applyFabrixToConfig(setCfg, {
        endpoint: config.endpointUrl ?? '',
        model: config.selectedModelId ?? '',
        configured: config.configured,
      });
    },
    [setCfg],
  );

  // Initial load — pull the masked config from the daemon once.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    let cancelled = false;
    void fetchFabrixConfig().then((config) => {
      if (cancelled || !config) return;
      ingestConfig(config);
    });
    return () => {
      cancelled = true;
    };
  }, [ingestConfig]);

  const trimmedEndpoint = endpointUrl.trim();
  const hasClient = clientInput.trim().length > 0 || clientConfigured;
  const hasToken = tokenInput.trim().length > 0 || tokenConfigured;
  const canFetch = trimmedEndpoint.length > 0 && hasClient && hasToken && !fetching;

  const handleFetch = useCallback(async () => {
    if (!canFetch) return;
    setFetching(true);
    setFetchError(null);
    setFetchedNotice(null);
    const result = await fetchFabrixModelsFromDaemon({
      endpointUrl: trimmedEndpoint,
      ...(clientInput.trim() ? { xFabrixClient: clientInput.trim() } : {}),
      ...(tokenInput.trim() ? { xOpenapiToken: tokenInput.trim() } : {}),
    });
    setFetching(false);
    if (!result.ok || !result.config) {
      setFetchError(result.errorMessage ?? '모델을 가져오지 못했습니다.');
      return;
    }
    // Clear secret inputs once stored — they are now owned by the daemon.
    setClientInput('');
    setTokenInput('');
    ingestConfig(result.config);
    setFetchedNotice(result.fetchedCount ?? result.config.models.length);
    notifyFabrixConfigChanged();
  }, [canFetch, trimmedEndpoint, clientInput, tokenInput, ingestConfig]);

  const handleSelectModel = useCallback(
    async (modelId: string) => {
      setSelectedModelId(modelId);
      applyFabrixToConfig(setCfg, {
        endpoint: trimmedEndpoint,
        model: modelId,
        configured: true,
      });
      const config = await selectFabrixModel(modelId);
      if (config) ingestConfig(config);
      notifyFabrixConfigChanged();
    },
    [setCfg, trimmedEndpoint, ingestConfig],
  );

  const handleSelectImageGenModel = useCallback(
    async (modelId: string) => {
      setImageGenModelId(modelId);
      const config = await setFabrixDefaultModels({ defaultT2iModelId: modelId || null });
      if (config) ingestConfig(config);
      notifyFabrixConfigChanged();
    },
    [ingestConfig],
  );

  const handleSelectImageAnalysisModel = useCallback(
    async (modelId: string) => {
      setImageAnalysisModelId(modelId);
      const config = await setFabrixDefaultModels({ defaultI2tModelId: modelId || null });
      if (config) ingestConfig(config);
      notifyFabrixConfigChanged();
    },
    [ingestConfig],
  );

  const selectedModel = models.find((m) => m.modelId === selectedModelId) ?? null;

  // The two per-surface pickers filter by raw capability `types` (a model may
  // advertise several), and only unlock once a primary model is selected.
  const imageGenModels = models.filter((m) => fabrixModelHasType(m, 'T2I'));
  const imageAnalysisModels = models.filter((m) => fabrixModelHasType(m, 'I2T'));
  const perSurfaceDisabled = models.length === 0 || !selectedModelId;

  return (
    <section className="settings-section settings-section-card settings-section-byok">
      <div className="section-head">
        <div>
          <h3>Samsung SDS FabriX</h3>
          <p className="hint">
            FabriX 엔터프라이즈 게이트웨이에 연결합니다. 모든 호출은 프록시를 거치지
            않고 직접 전송되며, 자격 증명은 사용자 홈 폴더의 <code>.open-design</code> 에
            저장됩니다.
          </p>
        </div>
      </div>

      {/* 1. Endpoint URL */}
      <label className="field">
        <span className="field-label">
          Endpoint URL
          <span className="field-required" aria-label="required">*</span>
        </span>
        <input
          type="text"
          inputMode="url"
          placeholder="https://your-fabrix-endpoint"
          value={endpointUrl}
          onChange={(e) => setEndpointUrl(e.target.value)}
          aria-label="FabriX Endpoint URL"
        />
      </label>

      {/* 2. x-fabrix-client */}
      <label className="field">
        <span className="field-label">
          x-fabrix-client
          <span className="field-required" aria-label="required">*</span>
        </span>
        <div className="field-row">
          <input
            type={showSecrets ? 'text' : 'password'}
            autoComplete="off"
            placeholder={clientConfigured ? '●●●●●●  (저장됨)' : 'x-fabrix-client'}
            value={clientInput}
            onChange={(e) => setClientInput(e.target.value)}
            aria-label="x-fabrix-client"
          />
          <button
            type="button"
            className="ghost icon-btn"
            onClick={() => setShowSecrets((v) => !v)}
          >
            {showSecrets ? '숨기기' : '표시'}
          </button>
        </div>
      </label>

      {/* 3. x-openapi-token */}
      <label className="field">
        <span className="field-label">
          x-openapi-token
          <span className="field-required" aria-label="required">*</span>
        </span>
        <div className="field-row">
          <input
            type={showSecrets ? 'text' : 'password'}
            autoComplete="off"
            placeholder={tokenConfigured ? '●●●●●●  (저장됨)' : 'x-openapi-token'}
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            aria-label="x-openapi-token"
          />
        </div>
        <span className="field-inline-status">
          저장된 자격 증명은 보안을 위해 화면에 표시되지 않습니다.
        </span>
      </label>

      {/* Fetch button — appears once all three fields are available */}
      {trimmedEndpoint && hasClient && hasToken ? (
        <div className="field">
          <button
            type="button"
            className={'primary' + (fetching ? ' loading' : '')}
            onClick={() => void handleFetch()}
            disabled={!canFetch}
            data-testid="fabrix-fetch-models"
          >
            {fetching ? '모델 가져오는 중…' : '모델 가져오기 (Fetch models)'}
          </button>
          {fetchedNotice != null ? (
            <span className="field-inline-status success" role="status">
              {fetchedNotice}개의 모델을 불러왔습니다.
            </span>
          ) : null}
          {fetchError ? (
            <span className="field-error" role="alert">
              {fetchError}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Model combobox — disabled until models are fetched */}
      <label className="field">
        <span className="field-label">
          모델 선택 (Model)
          <span className="field-required" aria-label="required">*</span>
        </span>
        <select
          value={selectedModelId}
          disabled={models.length === 0}
          onChange={(e) => void handleSelectModel(e.target.value)}
          aria-label="FabriX model"
          data-testid="fabrix-model-select"
        >
          {models.length === 0 ? (
            <option value="">먼저 모델을 가져오세요</option>
          ) : (
            <>
              <option value="" disabled>
                모델을 선택하세요
              </option>
              {models.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {`${m.name} — ${m.description ? `${m.description.slice(0, 60)} · ` : ''}${fabrixModelKindLabel(m.kind)}`}
                </option>
              ))}
            </>
          )}
        </select>
        {selectedModel ? (
          <span className="field-inline-status">
            {fabrixModelKindLabel(selectedModel.kind)}
            {selectedModel.description ? ` — ${selectedModel.description}` : ''}
          </span>
        ) : null}
      </label>

      {/* Image-analysis model (I2T only) — unlocks after a model is selected */}
      <label className="field">
        <span className="field-label">이미지 분석 모델 (Image analysis · I2T)</span>
        <select
          value={imageAnalysisModelId}
          disabled={perSurfaceDisabled}
          onChange={(e) => void handleSelectImageAnalysisModel(e.target.value)}
          aria-label="FabriX image analysis model"
          data-testid="fabrix-image-analysis-select"
        >
          {perSurfaceDisabled ? (
            <option value="">먼저 모델을 선택하세요</option>
          ) : (
            <>
              <option value="">선택 안 함</option>
              {imageAnalysisModels.length === 0 ? (
                <option value="" disabled>
                  I2T 모델이 없습니다
                </option>
              ) : (
                imageAnalysisModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.name}
                    {m.description ? ` — ${m.description.slice(0, 60)}` : ''}
                  </option>
                ))
              )}
            </>
          )}
        </select>
        <span className="field-inline-status">
          이미지 분석(I2T) 기능이 있는 모델만 선택할 수 있습니다.
        </span>
      </label>

      {/* Image-generation model (T2I only) — wired to the chat-time default */}
      <label className="field">
        <span className="field-label">이미지 생성 모델 (Image generation · T2I)</span>
        <select
          value={imageGenModelId}
          disabled={perSurfaceDisabled}
          onChange={(e) => void handleSelectImageGenModel(e.target.value)}
          aria-label="FabriX image generation model"
          data-testid="fabrix-image-gen-select"
        >
          {perSurfaceDisabled ? (
            <option value="">먼저 모델을 선택하세요</option>
          ) : (
            <>
              <option value="">선택 안 함</option>
              {imageGenModels.length === 0 ? (
                <option value="" disabled>
                  T2I 모델이 없습니다
                </option>
              ) : (
                imageGenModels.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    {m.name}
                    {m.description ? ` — ${m.description.slice(0, 60)}` : ''}
                  </option>
                ))
              )}
            </>
          )}
        </select>
        <span className="field-inline-status">
          이미지 생성(T2I) 모델만 선택할 수 있습니다. 여기서 고른 모델은 대화 중 이미지를
          생성할 때 최우선으로 사용됩니다.
        </span>
      </label>
    </section>
  );
}
