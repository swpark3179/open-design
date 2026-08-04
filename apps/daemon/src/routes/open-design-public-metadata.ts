import type { Express, Response } from 'express';
import type {
  OpenDesignDiscordPresenceResponse,
  OpenDesignGithubLatestReleaseResponse,
  OpenDesignGithubRepoResponse,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';
import {
  CLOSED_NETWORK_ERROR_CODE,
  isClosedNetworkError,
} from '../closed-network.js';
import {
  OPEN_DESIGN_DISCORD_INVITE_URL,
  type OpenDesignPublicMetadataService,
} from '../services/open-design-public-metadata.js';

export interface RegisterOpenDesignPublicMetadataRoutesDeps extends RouteDeps<'http'> {
  openDesignPublicMetadata: OpenDesignPublicMetadataService;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Closed-network refusals are 503 with a machine-readable code so a caller can
 * tell "policy says no" apart from the 502 that means GitHub/Discord is down.
 * Every handler here reaches the public internet, so they share one mapper.
 */
function sendUpstreamFailure(res: Response, error: unknown): void {
  if (isClosedNetworkError(error)) {
    res.status(503).json({ error: CLOSED_NETWORK_ERROR_CODE, message: errorMessage(error) });
    return;
  }
  res.status(502).json({ error: errorMessage(error) });
}

export function registerOpenDesignPublicMetadataRoutes(
  app: Express,
  ctx: RegisterOpenDesignPublicMetadataRoutesDeps,
): void {
  const { openDesignPublicMetadata } = ctx;

  app.get('/api/github/open-design', async (_req, res) => {
    try {
      const stats = await openDesignPublicMetadata.readGithubRepoStats();
      const payload: OpenDesignGithubRepoResponse = {
        repo: 'nexu-io/open-design',
        stargazers_count: stats.stargazersCount,
        fetchedAt: stats.fetchedAt,
        stale: stats.stale,
      };
      res.json(payload);
    } catch (error) {
      sendUpstreamFailure(res, error);
    }
  });

  app.get('/api/github/open-design/releases/latest', async (_req, res) => {
    try {
      const release = await openDesignPublicMetadata.readLatestReleaseInfo();
      const payload: OpenDesignGithubLatestReleaseResponse = {
        repo: 'nexu-io/open-design',
        tag_name: release.tagName,
        html_url: release.htmlUrl,
        fetchedAt: release.fetchedAt,
        stale: release.stale,
      };
      res.json(payload);
    } catch (error) {
      sendUpstreamFailure(res, error);
    }
  });

  app.get('/api/community/discord', async (_req, res) => {
    try {
      const presence = await openDesignPublicMetadata.readDiscordPresence();
      const payload: OpenDesignDiscordPresenceResponse = {
        inviteCode: 'mHAjSMV6gz',
        inviteUrl: OPEN_DESIGN_DISCORD_INVITE_URL,
        onlineCount: presence.onlineCount,
        memberCount: presence.memberCount,
        fetchedAt: presence.fetchedAt,
        stale: presence.stale,
      };
      res.json(payload);
    } catch (error) {
      sendUpstreamFailure(res, error);
    }
  });
}
