import { isStoredMediaProviderEntryPresent } from '../state/config';
import type { MediaProviderCredentials } from '../types';
import {
  findMediaModel,
  findProvider,
  mediaModelProviderId,
  type MediaProviderId,
} from './models';

export function isMediaProviderPickerReady(
  providerId: MediaProviderId,
  mediaProviders?: Record<string, MediaProviderCredentials>,
): boolean {
  const provider = findProvider(providerId);
  if (!provider?.integrated) return false;
  if (mediaProviders === undefined) return true;
  if (provider.credentialsRequired === false) return true;
  const entry = mediaProviders?.[provider.id];
  if (provider.id === 'openai' && isOpenAIOAuthOnlyEntry(entry)) return false;
  return isStoredMediaProviderEntryPresent(entry);
}

export function isMediaModelPickerReady(
  modelId: string,
  mediaProviders?: Record<string, MediaProviderCredentials>,
): boolean {
  const model = findMediaModel(modelId);
  if (model) return isMediaProviderPickerReady(model.provider, mediaProviders);
  // Live-discovered ids (e.g. `aihubmix-*`, `fabrix:*`) are absent from the
  // static registry; resolve their provider by id namespace so they aren't
  // falsely gated as "not ready".
  const dynamicProvider = mediaModelProviderId(modelId);
  if (dynamicProvider) return isMediaProviderPickerReady(dynamicProvider, mediaProviders);
  return false;
}

function isOpenAIOAuthOnlyEntry(entry: MediaProviderCredentials | null | undefined): boolean {
  const source = entry?.source?.trim();
  return (source === 'oauth-codex' || source === 'oauth-hermes')
    && !entry?.apiKey?.trim()
    && !entry?.baseUrl?.trim()
    && !entry?.model?.trim()
    && !entry?.apiKeyTail?.trim();
}
