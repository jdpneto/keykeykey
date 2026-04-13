import type { SyncConfig, SyncProvider } from '@keykeykey/core/sync';

// ---------------------------------------------------------------------------
// Platform Driver Interface
// ---------------------------------------------------------------------------

export interface SyncStatus {
  provider: SyncProvider;
  lastSynced: string | null;
  isSyncing: boolean;
  error: string | null;
}

export interface MismatchInfo {
  canRestore: boolean;
  remoteItemCount?: number;
}

export interface SyncSettingsDriver {
  validateMasterPassword(password: string): Promise<boolean>;
  saveConfig(config: SyncConfig): Promise<void>;
  getInitialState(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;
  refreshStatus(): Promise<{
    syncStatus: SyncStatus | null;
    mismatchInfo: MismatchInfo | null;
  }>;
  triggerSync(): Promise<{ lastSynced?: string; error?: string }>;
  disconnect(provider: SyncProvider): Promise<void>;
  startOAuth(
    provider: 'google-drive' | 'dropbox' | 'onedrive',
    masterPassword: string,
  ): Promise<void>;
  mergeVaults(): Promise<void>;
  replaceLocal(): Promise<void>;
  replaceRemote(): Promise<void>;
  clearMismatch(): Promise<void>;
  onConnected?(): void;
  onDisconnected?(): void;
}

// ---------------------------------------------------------------------------
// Hook Return Type
// ---------------------------------------------------------------------------

export type OAuthProvider = 'google-drive' | 'dropbox' | 'onedrive';

export interface SyncSettingsState {
  // Form fields
  syncProvider: SyncProvider;
  setSyncProvider: (p: SyncProvider) => void;
  webdavUrl: string;
  setWebdavUrl: (v: string) => void;
  webdavUsername: string;
  setWebdavUsername: (v: string) => void;
  webdavPassword: string;
  setWebdavPassword: (v: string) => void;
  masterPassword: string;
  setMasterPassword: (v: string) => void;

  // Derived
  isConnected: boolean;
  canConnect: boolean;

  // Status
  syncStatus: SyncStatus | null;
  mismatchInfo: MismatchInfo | null;
  error: string | null;
  loading: boolean;

  // Operation flags
  connecting: boolean;
  syncing: boolean;
  merging: boolean;
  replacingLocal: boolean;
  replacingRemote: boolean;
  showDisconnectConfirm: boolean;
  setShowDisconnectConfirm: (v: boolean) => void;

  // Actions
  handleWebdavConnect: () => Promise<void>;
  handleOAuthConnect: (provider: OAuthProvider) => Promise<void>;
  handleSyncNow: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleMismatchMerge: () => Promise<void>;
  handleMismatchReplaceLocal: () => Promise<void>;
  handleMismatchReplaceRemote: () => Promise<void>;
  handleMismatchCancel: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}
