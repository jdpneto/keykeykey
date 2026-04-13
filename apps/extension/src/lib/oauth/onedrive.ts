import { buildOneDriveAuthUrl, exchangeOneDriveAuthCode } from '@keykeykey/core/sync';
import { getBrowserKind, type BrowserKind } from '../browser-detect.js';
import { launchOAuthFlow } from './launch-flow.js';

const ONEDRIVE_CLIENT_IDS: Record<BrowserKind, string> = {
  chrome: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_CHROME ?? '',
  safari: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_SAFARI ?? '',
  firefox: import.meta.env.VITE_ONEDRIVE_CLIENT_ID_FIREFOX ?? '',
};

export const ONEDRIVE_CLIENT_ID = ONEDRIVE_CLIENT_IDS[getBrowserKind()];

export async function startOneDriveOAuth(): Promise<{ refreshToken: string }> {
  const result = await launchOAuthFlow({
    buildAuthUrl: (p) =>
      buildOneDriveAuthUrl({
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
        state: p.state,
      }),
    exchangeCode: (p) =>
      exchangeOneDriveAuthCode({
        code: p.code,
        clientId: p.clientId,
        redirectUri: p.redirectUri,
        codeVerifier: p.codeVerifier,
      }),
    clientId: ONEDRIVE_CLIENT_ID,
  });
  return { refreshToken: result.refreshToken };
}
