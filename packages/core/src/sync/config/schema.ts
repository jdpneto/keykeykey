import { z } from 'zod';

export type SyncProvider = 'none' | 'webdav' | 'google-drive' | 'dropbox' | 'onedrive';

export const SyncConfigSchema = z.object({
  provider: z.enum(['none', 'webdav', 'google-drive', 'dropbox', 'onedrive']),
  masterPassword: z.string().optional(),
  webdav: z.object({ url: z.string(), username: z.string(), password: z.string() }).optional(),
  googleDrive: z
    .object({
      refreshToken: z.string(),
      clientId: z.string(),
      clientSecret: z.string().optional(),
    })
    .optional(),
  dropbox: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
  onedrive: z.object({ refreshToken: z.string(), clientId: z.string() }).optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

export const DEFAULT_SYNC_CONFIG: SyncConfig = { provider: 'none' };
