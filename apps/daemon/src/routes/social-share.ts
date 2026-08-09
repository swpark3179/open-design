import type { Express } from 'express';
import {
  buildSocialSharePayload,
  isClosedNetworkCapabilityDisabled,
  normalizeSocialShareUrl,
  type SocialShareRequest,
} from '@open-design/contracts';
import type { RouteDeps } from '../server-context.js';

export interface RegisterSocialShareRoutesDeps
  extends RouteDeps<'http' | 'closedNetwork'> {}

export function registerSocialShareRoutes(
  app: Express,
  ctx: RegisterSocialShareRoutesDeps,
) {
  const { sendApiError } = ctx.http;
  const socialShareBlocked = isClosedNetworkCapabilityDisabled(
    ctx.closedNetwork,
    'social-share',
  );

  app.post('/api/social-share', (req, res) => {
    // Every payload this route builds is a link into x.com / linkedin.com /
    // weibo.com and friends. A closed-network deployment hides the share grid,
    // so reaching here means a stale renderer or a direct API caller — answer
    // honestly rather than handing back URLs nobody can open.
    if (socialShareBlocked) {
      return sendApiError(
        res,
        403,
        'CLOSED_NETWORK_BLOCKED',
        'social sharing is unavailable in closed-network mode',
      );
    }
    const body = (req.body ?? {}) as Partial<SocialShareRequest>;
    const kind = body.kind === 'project-html' ? 'project-html' : 'open-design-repo';
    if (kind === 'project-html' && !normalizeSocialShareUrl(body.url)) {
      return sendApiError(
        res,
        400,
        'BAD_REQUEST',
        'project-html social share requires an http(s) url',
      );
    }

    res.json(buildSocialSharePayload({ ...body, kind }));
  });
}
