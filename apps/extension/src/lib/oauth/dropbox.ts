import {
  buildDropboxAuthUrl,
  exchangeDropboxAuthCode,
  revokeDropboxToken as coreRevokeDropboxToken,
} from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from '../browser-detect.js';
import { launchOAuthFlow } from './launch-flow.js';

const DROPBOX_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_DROPBOX_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_DROPBOX_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_DROPBOX_CLIENT_ID_FIREFOX ?? '',
};

export const DROPBOX_CLIENT_ID = DROPBOX_CLIENT_IDS[getBrowserKind()];

export async function startDropboxOAuth(): Promise<{ refreshToken: string }> {
  const result = await launchOAuthFlow({
    buildAuthUrl: (p) =>
      buildDropboxAuthUrl({
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
        state: p.state,
      }),
    exchangeCode: (p) =>
      exchangeDropboxAuthCode({
        code: p.code,
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
      }),
    clientId: DROPBOX_CLIENT_ID,
  });
  return { refreshToken: result.refreshToken };
}

export const revokeDropboxToken = coreRevokeDropboxToken;
