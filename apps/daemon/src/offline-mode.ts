// Central offline-mode switch for intranet / air-gapped deployments.
//
// This fork targets environments where the deployed runtime must not reach
// the public internet (only the local network and GitHub Enterprise are
// reachable). Offline mode is therefore ON by default and gates every
// non-essential outbound call the daemon would otherwise make on its own:
// GitHub star/release lookups, Discord presence, PostHog/Langfuse telemetry,
// the plugin-preview R2 CDN fallback, and community pet catalog sync.
//
// Explicitly user-configured AI providers (BYOK endpoints, agent CLIs,
// media-generation APIs) are NOT gated here — provider selection stays the
// user's responsibility per the deployment policy.
//
// Set OD_OFFLINE=0 (or false/no/off) to restore the upstream online behavior.

const OFFLINE_ENV = 'OD_OFFLINE';

export function isOfflineMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[OFFLINE_ENV]?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') {
    return false;
  }
  return true;
}
