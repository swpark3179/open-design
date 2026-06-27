// Custom BYOK provider — config-file-templated LLM endpoints.
//
// Unlike the built-in BYOK protocols (anthropic/openai/azure/…), where the
// endpoint suffix, headers, request body, and response parser are all
// hardcoded in the daemon, a *custom* provider is defined entirely by a
// user-authored config file the daemon reads at startup
// (`~/.open-design/byok-providers.local.json`, override via
// `OD_BYOK_PROVIDERS_CONFIG`). The user picks the call endpoint, the fixed
// headers (API keys live here as fixed values), the request body template,
// the response text-extraction path, and the model list.
//
// These are pure DTOs shared between the daemon (loader + proxy) and the web
// app (provider picker). No Node/browser APIs here.
import type { ProxyMessage } from './proxy';
import type { ReasoningExecutionRequestFields } from './reasoningExecution';
import type { AgentModelOption } from './registry';

// One model the custom provider exposes. `label` is shown in the picker;
// `id` is what gets injected into the request body via the `{{model}}`
// template variable when the user selects it.
export type CustomByokModelOption = AgentModelOption;

// Full config-file shape for a single custom provider. Loaded daemon-side
// only — `headers` may carry secrets (API keys as fixed values), so this
// type must never be returned to the browser. Use {@link CustomByokProviderInfo}
// for UI-facing responses.
export interface CustomByokProviderConfig {
  // Stable identifier the UI/CLI pass back when starting a run.
  id: string;
  // Display name shown in the provider picker.
  label: string;
  // Full message-call endpoint URL (not just an origin — the complete path).
  endpoint: string;
  // HTTP method. Defaults to POST when omitted.
  method?: string;
  // Required + fixed-value headers. Values may contain template variables
  // ({{model}} etc.) but typically hold literal fixed strings, including the
  // API key (per the config-file-owns-secrets design).
  headers: Record<string, string>;
  // Request body template. String values are interpolated; a value that is
  // exactly the string "{{messages}}" is replaced wholesale with the message
  // array. See TEMPLATE variable list below.
  bodyTemplate: unknown;
  // Dotted path (with numeric indices) into the JSON response that yields the
  // assistant text, e.g. "choices.0.message.content" or "content.0.text".
  responseTextPath: string;
  // Models surfaced in the picker. `label` shown, `id` injected as {{model}}.
  models: CustomByokModelOption[];
}

// UI/CLI-facing projection of a custom provider. Deliberately omits
// `endpoint`, `headers`, `bodyTemplate`, and `responseTextPath` so secrets and
// internal wiring never reach the browser — only what's needed to render a
// picker.
export interface CustomByokProviderInfo {
  id: string;
  label: string;
  models: CustomByokModelOption[];
}

// Response of `GET /api/byok/custom-providers`.
export interface CustomByokProvidersResponse {
  providers: CustomByokProviderInfo[];
}

// Request body for `POST /api/proxy/custom/stream`. Note there is no `baseUrl`
// or `apiKey`: the daemon fills both from the config file. The browser only
// names which provider + model to use and the conversation.
export interface CustomProxyStreamRequest extends ReasoningExecutionRequestFields {
  providerId: string;
  model: string;
  systemPrompt?: string;
  messages: ProxyMessage[];
  // Optional cap hint; available to the body template as {{maxTokens}}.
  maxTokens?: number;
}

// Template variables the daemon substitution engine recognizes inside
// `headers` and `bodyTemplate`. String occurrences are interpolated; an
// exact-match string value of "{{messages}}" is replaced with the array.
export const CUSTOM_BYOK_TEMPLATE_VARS = [
  'model',
  'systemPrompt',
  'prompt',
  'messages',
  'maxTokens',
] as const;

export type CustomByokTemplateVar = (typeof CUSTOM_BYOK_TEMPLATE_VARS)[number];
