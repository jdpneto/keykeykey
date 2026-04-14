import { describe, it, expect } from 'vitest';
import { detectSource, importFromCsv, importPasswordsCsv, toVaultItems } from './importer.js';
import type { ImportedCredential } from './types.js';
import { VaultItemSchema } from '../models/vault-item.js';
import { randomUUID } from 'node:crypto';

const KEYKEYKEY_CSV = `name,url,username,password,notes,totp,folder,favorite
site.com,https://site.com/,user@email.com,pass1,a note,otpauth://totp/X?secret=ABC,work,true
`;

// Sample CSVs for each source (first few lines are enough for detection)
const CHROME_CSV = `name,url,username,password,note
site.com,https://site.com/,user@email.com,pass1,
`;

const FIREFOX_CSV = `"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
"https://site.com","user@email.com","pass1",,"https://site.com","guid1","1","1","1"
`;

const BITWARDEN_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,,login,site.com,,,0,https://site.com/,user@email.com,pass1,
`;

const ICLOUD_CSV = `Title,URL,Username,Password,Notes,OTPAuth
site.com (user@email.com),https://site.com/,user@email.com,pass1,,
`;

const ONEPASSWORD_CSV = `,"https://site.com",,"https://site.com","Login","user@email.com","pass1",
`;

describe('detectSource', () => {
  it('detects KeyKeyKey CSV', () => {
    expect(detectSource(KEYKEYKEY_CSV)).toBe('keykeykey');
  });

  it('detects Chrome CSV', () => {
    expect(detectSource(CHROME_CSV)).toBe('chrome');
  });

  it('detects Firefox CSV', () => {
    expect(detectSource(FIREFOX_CSV)).toBe('firefox');
  });

  it('detects Bitwarden CSV', () => {
    expect(detectSource(BITWARDEN_CSV)).toBe('bitwarden');
  });

  it('detects iCloud CSV', () => {
    expect(detectSource(ICLOUD_CSV)).toBe('icloud');
  });

  it('detects 1Password headerless CSV', () => {
    expect(detectSource(ONEPASSWORD_CSV)).toBe('1password');
  });

  it('falls back to 1password for headerless/unrecognizable CSV', () => {
    // No header-like keywords → heuristic falls through to 1password
    expect(detectSource('col1,col2,col3,col4\n1,2,3,4')).toBe('1password');
  });
});

describe('importFromCsv', () => {
  it('imports KeyKeyKey CSV with auto-detection', () => {
    const result = importFromCsv(KEYKEYKEY_CSV);
    expect(result.source).toBe('keykeykey');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].username).toBe('user@email.com');
    expect(result.items[0].notes).toBe('a note');
    expect(result.items[0].totp).toBe('otpauth://totp/X?secret=ABC');
    expect(result.items[0].folder).toBe('work');
    expect(result.items[0].favorite).toBe(true);
  });

  it('imports Chrome CSV with auto-detection', () => {
    const result = importFromCsv(CHROME_CSV);
    expect(result.source).toBe('chrome');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].username).toBe('user@email.com');
  });

  it('imports Firefox CSV with auto-detection', () => {
    const result = importFromCsv(FIREFOX_CSV);
    expect(result.source).toBe('firefox');
    expect(result.items).toHaveLength(1);
  });

  it('imports Bitwarden CSV with auto-detection', () => {
    const result = importFromCsv(BITWARDEN_CSV);
    expect(result.source).toBe('bitwarden');
    expect(result.items).toHaveLength(1);
  });

  it('imports iCloud CSV with auto-detection', () => {
    const result = importFromCsv(ICLOUD_CSV);
    expect(result.source).toBe('icloud');
    expect(result.items).toHaveLength(1);
  });

  it('imports 1Password CSV with auto-detection', () => {
    const result = importFromCsv(ONEPASSWORD_CSV);
    expect(result.source).toBe('1password');
    expect(result.items).toHaveLength(1);
  });

  it('accepts explicit source override', () => {
    const result = importFromCsv(CHROME_CSV, 'chrome');
    expect(result.source).toBe('chrome');
    expect(result.items).toHaveLength(1);
  });

  it('returns skipped rows', () => {
    const csv = `name,url,username,password,note
site.com,https://site.com/,,,
valid.com,https://valid.com/,user,pass,
`;
    const result = importFromCsv(csv, 'chrome');
    expect(result.items).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('No username or password');
  });
});

describe('toVaultItems', () => {
  it('converts ImportedCredentials to VaultItem shape', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'Test Site',
        url: 'https://test.com',
        appIdentifiers: [],
        username: 'user',
        password: 'pass',
        notes: 'A note',
        totp: 'otpauth://totp/Test',
        folder: '',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('credential');
    expect(items[0].name).toBe('Test Site');
    expect(items[0].username).toBe('user');
    expect(items[0].password).toBe('pass');
    expect(items[0].url).toBe('https://test.com');
    expect(items[0].notes).toBe('A note');
    expect(items[0].totp).toBe('otpauth://totp/Test');
    expect(items[0].tags).toEqual([]);
    expect(items[0].favorite).toBe(false);
  });

  it('converts folder names to tags', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'Work Login',
        url: 'https://work.com',
        appIdentifiers: [],
        username: 'worker',
        password: 'pass',
        notes: '',
        totp: '',
        folder: 'Work',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0].tags).toEqual(['Work']);
  });

  it('sets favorite flag', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'Fav',
        url: '',
        appIdentifiers: [],
        username: 'user',
        password: 'pass',
        notes: '',
        totp: '',
        folder: '',
        favorite: true,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0].favorite).toBe(true);
  });

  it('uses undefined for empty optional fields', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'Minimal',
        url: '',
        appIdentifiers: [],
        username: 'user',
        password: 'pass',
        notes: '',
        totp: '',
        folder: '',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0].url).toBeUndefined();
    expect(items[0].notes).toBeUndefined();
    expect(items[0].totp).toBeUndefined();
  });

  it('defaults empty name to "Unnamed"', () => {
    const creds: ImportedCredential[] = [
      {
        name: '',
        url: '',
        appIdentifiers: [],
        username: 'user',
        password: 'pass',
        notes: '',
        totp: '',
        folder: '',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0].name).toBe('Unnamed');
  });

  it('forwards non-empty appIdentifiers from the IR', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'App',
        url: '',
        appIdentifiers: ['com.example.app'],
        username: 'user',
        password: 'pass',
        notes: '',
        totp: '',
        folder: '',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0]).toMatchObject({
      type: 'credential',
      name: 'App',
      url: undefined,
      appIdentifiers: ['com.example.app'],
    });
  });

  it('collapses empty appIdentifiers to undefined', () => {
    const creds: ImportedCredential[] = [
      {
        name: 'Site',
        url: 'https://site.com',
        appIdentifiers: [],
        username: 'user',
        password: 'pass',
        notes: '',
        totp: '',
        folder: '',
        favorite: false,
      },
    ];

    const items = toVaultItems(creds);
    expect(items[0].appIdentifiers).toBeUndefined();
  });
});

describe('importPasswordsCsv (full pipeline)', () => {
  it('returns VaultItem-ready objects with metadata', () => {
    const result = importPasswordsCsv(CHROME_CSV);
    expect(result.source).toBe('chrome');
    expect(result.totalParsed).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('credential');
    expect(result.items[0].name).toBe('site.com');
    expect(result.items[0].username).toBe('user@email.com');
  });

  it('works with Bitwarden including folders as tags', () => {
    const csv = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
Work,1,login,Office365,,,0,https://office.com/,worker@co.com,workpass,
`;
    const result = importPasswordsCsv(csv, 'bitwarden');
    expect(result.items[0].tags).toEqual(['Work']);
    expect(result.items[0].favorite).toBe(true);
  });

  it('round-trips KeyKeyKey export → import with all fields preserved', () => {
    const result = importPasswordsCsv(KEYKEYKEY_CSV);
    expect(result.source).toBe('keykeykey');
    expect(result.totalParsed).toBe(1);
    expect(result.items[0].type).toBe('credential');
    expect(result.items[0].name).toBe('site.com');
    expect(result.items[0].username).toBe('user@email.com');
    expect(result.items[0].notes).toBe('a note');
    expect(result.items[0].totp).toBe('otpauth://totp/X?secret=ABC');
    expect(result.items[0].tags).toEqual(['work']);
    expect(result.items[0].favorite).toBe(true);
  });
});

describe('regression: every source CSV produces VaultItemSchema-valid items', () => {
  // Bitwarden CSV extended with rows that previously broke the import:
  //  - schemeless hostnames (would fail z.string().url())
  //  - androidapp:// app URIs (should route to appIdentifiers)
  //  - iosapp:// app URIs (should route to appIdentifiers)
  const BITWARDEN_REGRESSION_CSV = `folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp
,,login,ok,,,0,https://ok.com/,u,p,
,,login,schemeless,,,0,schemeless.example.com,u,p,
,,login,android,,,0,androidapp://com.tesla.TeslaApp/,u,p,
,,login,ios,,,0,iosapp://com.apple.notes,u,p,
`;

  const CSVS: Array<[string, string]> = [
    ['keykeykey', KEYKEYKEY_CSV],
    ['chrome', CHROME_CSV],
    ['firefox', FIREFOX_CSV],
    ['bitwarden', BITWARDEN_REGRESSION_CSV],
    ['icloud', ICLOUD_CSV],
    ['1password', ONEPASSWORD_CSV],
  ];

  const now = new Date().toISOString();

  it.each(CSVS)('every item from %s CSV passes VaultItemSchema.parse', (source, csv) => {
    const result = importPasswordsCsv(csv, source as Parameters<typeof importPasswordsCsv>[1]);

    expect(result.items.length).toBeGreaterThan(0);

    for (const item of result.items) {
      const withMeta = { ...item, id: randomUUID(), createdAt: now, updatedAt: now };
      expect(() => VaultItemSchema.parse(withMeta)).not.toThrow();
    }
  });
});
