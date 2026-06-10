import type { SyncProvider } from './schema.js';

/**
 * The sync providers offered in the UI and instantiable by the sync engine.
 *
 * The OAuth providers (google-drive, dropbox, onedrive) are fully implemented
 * but disabled: provider rate limits make sync unreliable and full-vault
 * downloads unacceptably slow. See docs/OAUTH_DISABLED.md before changing
 * this list — re-enabling requires more than editing it.
 */
export const ENABLED_SYNC_PROVIDERS: readonly SyncProvider[] = ['none', 'webdav'];

/** Whether a provider may be offered in the UI / instantiated by the engine. */
export function isSyncProviderEnabled(provider: SyncProvider): boolean {
  return ENABLED_SYNC_PROVIDERS.includes(provider);
}
