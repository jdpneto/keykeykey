/** Thrown when a sync adapter's auth token is expired or invalid. */
export class SyncAuthError extends Error {
  constructor(message = 'Sync authentication failed — re-authenticate to continue syncing') {
    super(message);
    this.name = 'SyncAuthError';
  }
}

/** Thrown when a sync adapter is used on an unsupported platform. */
export class SyncAdapterUnsupportedError extends Error {
  constructor(adapter: string, platform: string) {
    super(`${adapter} is not supported on ${platform}`);
    this.name = 'SyncAdapterUnsupportedError';
  }
}
