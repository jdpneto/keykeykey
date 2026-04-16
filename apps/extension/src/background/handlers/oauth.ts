/**
 * OAuth handlers: Google Drive, Dropbox, OneDrive connect/get-token/disconnect.
 */

import browser from 'webextension-polyfill';
import { deserializeVaultHeader } from '@keykeykey/core';
import { unlockVault } from '@keykeykey/core/crypto';
import { fromBase64 } from '@keykeykey/core/utils';
import type { SyncConfig } from '@keykeykey/core/sync';
import {
  startGoogleOAuth,
  revokeGoogleToken,
  startDropboxOAuth,
  revokeDropboxToken,
  DROPBOX_CLIENT_ID,
  startOneDriveOAuth,
  ONEDRIVE_CLIENT_ID,
} from '../../lib/oauth/index.js';
import { clearSyncConfig } from '../storage.js';
import type { HandlerContext } from '../context.js';
import { rejectIfExternal } from './sender-guard.js';

// ---------------------------------------------------------------------------
// GOOGLE_OAUTH_CONNECT
// ---------------------------------------------------------------------------

export async function googleOAuthConnect(
  msg: { type: 'GOOGLE_OAUTH_CONNECT'; masterPassword: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  // Validate master password before starting OAuth flow
  if (!ctx.headerBase64) return { error: 'Vault not set up' };
  try {
    const hdrBytes = fromBase64(ctx.headerBase64);
    const hdr = deserializeVaultHeader(hdrBytes);
    const dek = await unlockVault(hdr, msg.masterPassword);
    dek.fill(0);
  } catch {
    return { error: 'Incorrect master password' };
  }
  // Persist "connecting" BEFORE opening the OAuth window — Chrome closes
  // the extension popup as soon as the OAuth tab takes focus, so we
  // need a side channel for the popup to route back to sync-settings
  // on reopen.
  await ctx.setSyncConnectState({ status: 'connecting', provider: 'google-drive' });
  try {
    // Chrome: interactive getAuthToken, returns 'chrome-identity' placeholders.
    // Firefox: PKCE via launchWebAuthFlow, returns real refreshToken + clientId + clientSecret.
    const { refreshToken, clientId, clientSecret } = await startGoogleOAuth();
    const config: SyncConfig = {
      provider: 'google-drive',
      masterPassword: msg.masterPassword,
      googleDrive: { refreshToken, clientId, clientSecret },
    };
    let lc = ctx.getLifecycle();
    if (!lc) {
      lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    }
    await lc.saveConfig(config);
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'google-drive',
        timestamp: new Date().toISOString(),
      },
    });
    // Trigger the initial sync here in the backend instead of relying on
    // the popup — the popup has almost certainly been closed by now
    // (the OAuth tab took focus). Any mismatch will land in mismatchInfo
    // and the SyncSettingsScreen will pick it up on next mount. We
    // swallow the error because the sync failing (e.g. due to a vault
    // mismatch) is an expected, user-recoverable state, not a CONNECT
    // failure.
    try {
      const syncResult = await lc.triggerSync();
      if (syncResult.lastSynced) {
        ctx.setLastSynced(syncResult.lastSynced);
        ctx.setSyncError(null);
      }
      if (syncResult.error) {
        ctx.setSyncError(syncResult.error);
      }
    } catch {
      // ignore — covered by setSyncError via the lifecycle path above
    }
    await ctx.setSyncConnectState({ status: 'idle' });
    return { ok: true };
  } catch (err) {
    await ctx.setSyncConnectState({
      status: 'error',
      provider: 'google-drive',
      error: err instanceof Error ? err.message : 'Google sign-in failed',
    });
    return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// GOOGLE_OAUTH_GET_TOKEN
// ---------------------------------------------------------------------------

export async function googleOAuthGetToken(
  _msg: { type: 'GOOGLE_OAUTH_GET_TOKEN' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  // Allow during restore (no vault header) or when unlocked
  if (ctx.headerBase64 && ctx.store.getState().status !== 'unlocked') {
    return { error: 'Vault must be unlocked' };
  }
  try {
    // Chrome: interactive getAuthToken, returns 'chrome-identity' placeholders
    //   (adapter uses getAuthToken directly at sync time).
    // Firefox: PKCE via launchWebAuthFlow, returns real refreshToken + clientId
    //   (core's createCachedTokenProvider uses them at sync time).
    const { refreshToken, clientId, clientSecret } = await startGoogleOAuth();
    const tokens = { refreshToken, clientId, clientSecret };
    // Persist provider + tokens so the popup can pick up where it left
    // off after launchWebAuthFlow closes the popup (Firefox/all browsers).
    // SetupScreen reads last_connected_provider to show the shortcut;
    // RestoreScreen reads restore_oauth_tokens to skip re-authentication.
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'google-drive',
        timestamp: new Date().toISOString(),
      },
      restore_oauth_tokens: {
        provider: 'google-drive',
        ...tokens,
      },
    });
    return tokens;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Google sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// GOOGLE_OAUTH_DISCONNECT
// ---------------------------------------------------------------------------

export async function googleOAuthDisconnect(
  _msg: { type: 'GOOGLE_OAUTH_DISCONNECT' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  try {
    // Firefox needs the stored refresh token to revoke; Chrome ignores the arg.
    const currentConfig = ctx.getCurrentConfig();
    await revokeGoogleToken(currentConfig?.googleDrive?.refreshToken);
    const lc = ctx.getLifecycle();
    if (lc) {
      // saveConfig({ provider: 'none' }) tears down the engine but keeps
      // the lifecycle instance alive so the user can connect to a
      // different provider without re-unlocking the vault.
      await lc.saveConfig({ provider: 'none' });
    }
    ctx.setLastSynced(null);
    ctx.setSyncError(null);
    await clearSyncConfig();
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Disconnect failed' };
  }
}

// ---------------------------------------------------------------------------
// DROPBOX_OAUTH_CONNECT
// ---------------------------------------------------------------------------

export async function dropboxOAuthConnect(
  msg: { type: 'DROPBOX_OAUTH_CONNECT'; masterPassword: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  // Validate master password before starting OAuth flow
  if (!ctx.headerBase64) return { error: 'Vault not set up' };
  try {
    const hdrBytes = fromBase64(ctx.headerBase64);
    const hdr = deserializeVaultHeader(hdrBytes);
    const dek = await unlockVault(hdr, msg.masterPassword);
    dek.fill(0);
  } catch {
    return { error: 'Incorrect master password' };
  }
  await ctx.setSyncConnectState({ status: 'connecting', provider: 'dropbox' });
  try {
    const { refreshToken } = await startDropboxOAuth();
    const config: SyncConfig = {
      provider: 'dropbox',
      masterPassword: msg.masterPassword,
      dropbox: { refreshToken, clientId: DROPBOX_CLIENT_ID },
    };
    let lc = ctx.getLifecycle();
    if (!lc) {
      lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    }
    await lc.saveConfig(config);
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'dropbox',
        timestamp: new Date().toISOString(),
      },
    });
    // Fire the initial sync here so the popup doesn't need to do it
    // after reopening — see GOOGLE_OAUTH_CONNECT for rationale.
    try {
      const syncResult = await lc.triggerSync();
      if (syncResult.lastSynced) {
        ctx.setLastSynced(syncResult.lastSynced);
        ctx.setSyncError(null);
      }
      if (syncResult.error) {
        ctx.setSyncError(syncResult.error);
      }
    } catch {
      // ignore
    }
    await ctx.setSyncConnectState({ status: 'idle' });
    return { ok: true };
  } catch (err) {
    await ctx.setSyncConnectState({
      status: 'error',
      provider: 'dropbox',
      error: err instanceof Error ? err.message : 'Dropbox sign-in failed',
    });
    return { error: err instanceof Error ? err.message : 'Dropbox sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// DROPBOX_OAUTH_GET_TOKEN
// ---------------------------------------------------------------------------

export async function dropboxOAuthGetToken(
  _msg: { type: 'DROPBOX_OAUTH_GET_TOKEN' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  if (ctx.headerBase64 && ctx.store.getState().status !== 'unlocked') {
    return { error: 'Vault must be unlocked' };
  }
  try {
    const { refreshToken } = await startDropboxOAuth();
    const tokens = { refreshToken, clientId: DROPBOX_CLIENT_ID };
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'dropbox',
        timestamp: new Date().toISOString(),
      },
      restore_oauth_tokens: {
        provider: 'dropbox',
        ...tokens,
      },
    });
    return tokens;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Dropbox sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// DROPBOX_OAUTH_DISCONNECT
// ---------------------------------------------------------------------------

export async function dropboxOAuthDisconnect(
  _msg: { type: 'DROPBOX_OAUTH_DISCONNECT' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  try {
    // Best-effort revocation of Dropbox refresh token
    try {
      const cfg = ctx.getCurrentConfig();
      if (cfg?.dropbox?.refreshToken) {
        await revokeDropboxToken(cfg.dropbox.refreshToken);
      }
    } catch {
      // Best-effort — continue with disconnect even if revocation fails
    }
    const lc = ctx.getLifecycle();
    if (lc) {
      // Keep the lifecycle alive so the user can connect to a different
      // provider (e.g. Google Drive) without re-unlocking the vault.
      await lc.saveConfig({ provider: 'none' });
    }
    ctx.setLastSynced(null);
    ctx.setSyncError(null);
    await clearSyncConfig();
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Disconnect failed' };
  }
}

// ---------------------------------------------------------------------------
// ONEDRIVE_OAUTH_CONNECT
// ---------------------------------------------------------------------------

export async function onedriveOAuthConnect(
  msg: { type: 'ONEDRIVE_OAUTH_CONNECT'; masterPassword: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  // Validate master password before starting OAuth flow
  if (!ctx.headerBase64) return { error: 'Vault not set up' };
  try {
    const hdrBytes = fromBase64(ctx.headerBase64);
    const hdr = deserializeVaultHeader(hdrBytes);
    const dek = await unlockVault(hdr, msg.masterPassword);
    dek.fill(0);
  } catch {
    return { error: 'Incorrect master password' };
  }
  await ctx.setSyncConnectState({ status: 'connecting', provider: 'onedrive' });
  try {
    const { refreshToken } = await startOneDriveOAuth();
    const config: SyncConfig = {
      provider: 'onedrive',
      masterPassword: msg.masterPassword,
      onedrive: { refreshToken, clientId: ONEDRIVE_CLIENT_ID },
    };
    let lc = ctx.getLifecycle();
    if (!lc) {
      lc = ctx.initLifecycle(ctx.syncableStore, () => ctx.store.getState().header ?? null);
    }
    await lc.saveConfig(config);
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'onedrive',
        timestamp: new Date().toISOString(),
      },
    });
    // Fire the initial sync here — see GOOGLE_OAUTH_CONNECT for rationale.
    try {
      const syncResult = await lc.triggerSync();
      if (syncResult.lastSynced) {
        ctx.setLastSynced(syncResult.lastSynced);
        ctx.setSyncError(null);
      }
      if (syncResult.error) {
        ctx.setSyncError(syncResult.error);
      }
    } catch {
      // ignore
    }
    await ctx.setSyncConnectState({ status: 'idle' });
    return { ok: true };
  } catch (err) {
    await ctx.setSyncConnectState({
      status: 'error',
      provider: 'onedrive',
      error: err instanceof Error ? err.message : 'OneDrive sign-in failed',
    });
    return { error: err instanceof Error ? err.message : 'OneDrive sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// ONEDRIVE_OAUTH_GET_TOKEN
// ---------------------------------------------------------------------------

export async function onedriveOAuthGetToken(
  _msg: { type: 'ONEDRIVE_OAUTH_GET_TOKEN' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  if (ctx.headerBase64 && ctx.store.getState().status !== 'unlocked') {
    return { error: 'Vault must be unlocked' };
  }
  try {
    const { refreshToken } = await startOneDriveOAuth();
    const tokens = { refreshToken, clientId: ONEDRIVE_CLIENT_ID };
    await browser.storage.local.set({
      last_connected_provider: {
        provider: 'onedrive',
        timestamp: new Date().toISOString(),
      },
      restore_oauth_tokens: {
        provider: 'onedrive',
        ...tokens,
      },
    });
    return tokens;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'OneDrive sign-in failed' };
  }
}

// ---------------------------------------------------------------------------
// ONEDRIVE_OAUTH_DISCONNECT
// ---------------------------------------------------------------------------

export async function onedriveOAuthDisconnect(
  _msg: { type: 'ONEDRIVE_OAUTH_DISCONNECT' },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const rejected = rejectIfExternal(sender);
  if (rejected) return rejected;
  try {
    // Microsoft doesn't support simple token revocation — just clear config
    const lc = ctx.getLifecycle();
    if (lc) {
      // Keep the lifecycle alive so the user can connect to a different
      // provider without re-unlocking the vault.
      await lc.saveConfig({ provider: 'none' });
    }
    ctx.setLastSynced(null);
    ctx.setSyncError(null);
    await clearSyncConfig();
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Disconnect failed' };
  }
}
