import { useEffect, useState } from 'react';
import type { CustomByokProviderInfo } from '@open-design/contracts';
import { listCustomByokProviders } from '../../providers/custom-compatible';
import { SearchableModelSelect } from '../modelOptions';

interface ByokCustomFieldsProps {
  providerId: string;
  model: string;
  labels: {
    provider: string;
    providerHint: string;
    providerEmpty: string;
    providerPlaceholder: string;
    model: string;
    required: string;
    searchPlaceholder: string;
  };
  // Called when the user picks a provider. `firstModel` is the provider's
  // first declared model id (so the caller can seed a default selection).
  onProviderChange: (providerId: string, firstModel: string) => void;
  onModelChange: (model: string) => void;
}

/**
 * Settings fields for the *custom* BYOK protocol. The provider list — and each
 * provider's models — come from the daemon-side config file via
 * `GET /api/byok/custom-providers`; the endpoint, headers, and secrets never
 * reach the browser. The user only picks a provider and one of its models.
 */
export function ByokCustomFields({
  providerId,
  model,
  labels,
  onProviderChange,
  onModelChange,
}: ByokCustomFieldsProps) {
  const [providers, setProviders] = useState<CustomByokProviderInfo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listCustomByokProviders().then((list) => {
      if (!cancelled) setProviders(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = providers?.find((p) => p.id === providerId);
  const models = selected?.models ?? [];

  if (providers !== null && providers.length === 0) {
    return <p className="hint">{labels.providerEmpty}</p>;
  }

  return (
    <>
      <label className="field">
        <span className="field-label">
          {labels.provider}
          <span className="field-required" aria-label={labels.required}>
            *
          </span>
        </span>
        <select
          aria-label={labels.provider}
          value={providerId}
          onChange={(e) => {
            const next = providers?.find((p) => p.id === e.target.value);
            onProviderChange(next?.id ?? '', next?.models[0]?.id ?? '');
          }}
        >
          <option value="" disabled>
            {labels.providerPlaceholder}
          </option>
          {(providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="hint">{labels.providerHint}</p>
      </label>
      {selected ? (
        <label className="field">
          <span className="field-label">
            {labels.model}
            <span className="field-required" aria-label={labels.required}>
              *
            </span>
          </span>
          <SearchableModelSelect
            className="inline-switcher__select settings-model-select settings-model-select--byok"
            aria-label={labels.model}
            searchPlaceholder={labels.searchPlaceholder}
            popoverClassName="settings-byok-select-popover"
            models={models}
            value={model}
            onChange={(next) => onModelChange(next)}
          />
        </label>
      ) : null}
    </>
  );
}
