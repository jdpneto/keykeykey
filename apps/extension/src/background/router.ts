/**
 * Message router — maps message type strings to handler functions.
 *
 * Every handler has the same signature:
 *   (msg: any, ctx: HandlerContext, sender?: unknown) => Promise<unknown>
 */

import {
  vault,
  items,
  credentials,
  sync,
  oauth,
  importExport,
  settings,
} from './handlers/index.js';
import type { HandlerContext } from './context.js';

// ---------------------------------------------------------------------------
// Handler function type
// ---------------------------------------------------------------------------

type Handler = (msg: never, ctx: HandlerContext, sender?: unknown) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const ROUTES: Record<string, Handler> = {
  // Vault lifecycle
  GET_STATUS: vault.getStatus as Handler,
  SETUP: vault.setup as Handler,
  UNLOCK: vault.unlock as Handler,
  UNLOCK_PIN: vault.unlockPin as Handler,
  LOCK: vault.lock as Handler,
  VALIDATE_MASTER_PASSWORD: vault.validateMasterPassword as Handler,
  RESET_VAULT: vault.resetVault as Handler,

  // Items CRUD
  GET_ITEMS: items.getItems as Handler,
  GET_ITEMS_FOR_HOST: items.getItemsForHost as Handler,
  SEARCH: items.search as Handler,
  ADD_ITEM: items.addItem as Handler,
  UPDATE_ITEM: items.updateItem as Handler,
  DELETE_ITEM: items.deleteItem as Handler,

  // Credentials / autofill
  GET_CREDENTIALS_FOR_TAB: credentials.getCredentialsForTab as Handler,
  GET_MATCHING_CREDENTIALS: credentials.getMatchingCredentials as Handler,
  FILL_CREDENTIAL: credentials.fillCredential as Handler,
  CHECK_CREDENTIAL_EXISTS: credentials.checkCredentialExists as Handler,
  SAVE_CREDENTIAL: credentials.saveCredential as Handler,
  UPDATE_CREDENTIAL: credentials.updateCredential as Handler,
  FILL_ACTIVE_TAB: credentials.fillActiveTab as Handler,

  // Sync
  GET_SYNC_STATUS: sync.getSyncStatus as Handler,
  CONFIGURE_SYNC: sync.configureSync as Handler,
  TRIGGER_SYNC: sync.triggerSync as Handler,
  DISCONNECT_SYNC: sync.disconnectSync as Handler,
  RESTORE_FROM_CLOUD: sync.restoreFromCloud as Handler,
  CLEAR_RESTORE_STATUS: sync.clearRestoreStatus as Handler,
  GET_MISMATCH_INFO: sync.getMismatchInfo as Handler,
  CLEAR_MISMATCH: sync.clearMismatch as Handler,
  REPLACE_REMOTE: sync.replaceRemote as Handler,
  REPLACE_LOCAL: sync.replaceLocal as Handler,
  MERGE_VAULTS: sync.mergeVaults as Handler,
  CLEAR_SYNC_OP_STATUS: sync.clearSyncOpStatus as Handler,
  CLEAR_SYNC_CONNECT_STATUS: sync.clearSyncConnectStatus as Handler,

  // OAuth
  GOOGLE_OAUTH_CONNECT: oauth.googleOAuthConnect as Handler,
  GOOGLE_OAUTH_GET_TOKEN: oauth.googleOAuthGetToken as Handler,
  GOOGLE_OAUTH_DISCONNECT: oauth.googleOAuthDisconnect as Handler,
  DROPBOX_OAUTH_CONNECT: oauth.dropboxOAuthConnect as Handler,
  DROPBOX_OAUTH_GET_TOKEN: oauth.dropboxOAuthGetToken as Handler,
  DROPBOX_OAUTH_DISCONNECT: oauth.dropboxOAuthDisconnect as Handler,
  ONEDRIVE_OAUTH_CONNECT: oauth.onedriveOAuthConnect as Handler,
  ONEDRIVE_OAUTH_GET_TOKEN: oauth.onedriveOAuthGetToken as Handler,
  ONEDRIVE_OAUTH_DISCONNECT: oauth.onedriveOAuthDisconnect as Handler,

  // Import / export
  IMPORT_ITEMS: importExport.importItems as Handler,
  GET_IMPORT_STATUS: importExport.getImportStatus as Handler,
  CLEAR_IMPORT_STATUS: importExport.clearImportStatus as Handler,

  // Settings & utilities
  GET_SETTINGS: settings.getSettings as Handler,
  UPDATE_SETTINGS: settings.updateSettings as Handler,
  SET_PIN: settings.setPin as Handler,
  REMOVE_PIN: settings.removePin as Handler,
  GENERATE_PASSWORD: settings.generatePasswordHandler as Handler,
  GET_ACTIVE_TAB_URL: settings.getActiveTabUrl as Handler,
  CAPTURE_VISIBLE_TAB: settings.captureVisibleTab as Handler,
  CLIPBOARD_COPIED: settings.clipboardCopied as Handler,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function routeMessage(
  msg: { type: string },
  ctx: HandlerContext,
  sender?: unknown,
): Promise<unknown> {
  const handler = ROUTES[msg.type];
  if (!handler) {
    return Promise.resolve({ error: `Unknown message type: ${msg.type}` });
  }
  return handler(msg as never, ctx, sender);
}
