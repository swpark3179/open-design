/**
 * Response body for `GET /api/daemon/status` — process-level facts about the
 * running daemon that every domain can rely on. This is the read side of the
 * deployment switches (`sandboxMode`, `closedNetwork`); user preferences live
 * in `app-config.ts` instead.
 */
export interface DaemonStatusResponse {
  ok: true;
  version: string;
  bindHost: string;
  port: number;
  dataDir: string;
  mediaConfigDir: string | null;
  sandboxMode: boolean;
  sandbox: { enabled: false } | { enabled: true; roots: unknown };
  /**
   * Closed-network (intranet / air-gapped) mode. Resolved by the daemon from
   * the `~/.open-design/closed-network` marker file, `OD_CLOSED_NETWORK`, or
   * the `--closed-network` launch flag — never from client-writable app config,
   * so the web UI can treat it as administrator-locked and read-only.
   *
   * When true the daemon refuses every automatic outbound request (GitHub repo
   * stats, Discord presence, What's New, analytics, install attribution) and
   * the web UI hides its SNS, share, and external-link surfaces.
   */
  closedNetwork: boolean;
  pid: number;
  shuttingDown: boolean;
  installedPlugins: number;
}

/**
 * The subset of daemon status the web renderer consumes at bootstrap to decide
 * which surfaces to render. Kept separate from the full status shape so the UI
 * does not grow a dependency on transport-level fields such as `port`.
 */
export interface DaemonRuntimeFlags {
  closedNetwork: boolean;
}
