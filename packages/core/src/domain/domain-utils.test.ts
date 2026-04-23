import { describe, it, expect } from 'vitest';
import {
  extractDomainBrand,
  matchCredentials,
  matchCredentialsByAppIdentifier,
  matchCredentialsByDomain,
  normalizeUrl,
} from './domain-utils.js';
import type { VaultItem } from '../models/vault-item.js';

describe('normalizeUrl', () => {
  it('should add https:// to URLs without protocol', () => {
    expect(normalizeUrl('github.com')).toBe('https://github.com');
  });

  it('should leave URLs with protocol unchanged', () => {
    expect(normalizeUrl('https://github.com')).toBe('https://github.com');
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('should return empty string for empty input', () => {
    expect(normalizeUrl('')).toBe('');
  });
});

describe('extractDomainBrand', () => {
  it('should extract brand from simple URL', () => {
    expect(extractDomainBrand('https://github.com')).toBe('github');
  });

  it('should strip common subdomains', () => {
    expect(extractDomainBrand('https://login.github.com/oauth')).toBe('github');
    expect(extractDomainBrand('https://www.google.com')).toBe('google');
    expect(extractDomainBrand('https://accounts.google.com')).toBe('google');
    expect(extractDomainBrand('https://app.slack.com')).toBe('slack');
    expect(extractDomainBrand('https://mail.yahoo.com')).toBe('yahoo');
  });

  it('should handle multi-level TLDs', () => {
    expect(extractDomainBrand('https://www.bbc.co.uk')).toBe('bbc');
    expect(extractDomainBrand('https://login.empresa.com.br')).toBe('empresa');
  });

  it('should handle URLs with paths and query strings', () => {
    expect(extractDomainBrand('https://github.com/user/repo?tab=code')).toBe('github');
  });

  it('should handle URLs without protocol', () => {
    expect(extractDomainBrand('github.com')).toBe('github');
  });

  it('should return hostname for IP addresses', () => {
    expect(extractDomainBrand('http://192.168.1.1:8080')).toBe('192.168.1.1');
  });

  it('should handle localhost', () => {
    expect(extractDomainBrand('http://localhost:3000')).toBe('localhost');
  });

  it('should return empty string for invalid input', () => {
    expect(extractDomainBrand('')).toBe('');
  });
});

describe('matchCredentialsByDomain', () => {
  const items: VaultItem[] = [
    {
      id: '1',
      type: 'credential',
      name: 'GitHub',
      username: 'user',
      password: 'pass',
      url: 'https://github.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2',
      type: 'credential',
      name: 'Google',
      username: 'user',
      password: 'pass',
      url: 'https://accounts.google.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3',
      type: 'secure-note',
      name: 'Note',
      content: 'secret',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match credentials by exact domain', () => {
    const matches = matchCredentialsByDomain('login.github.com', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });

  it('should match when stored URL domain contains query hostname', () => {
    const matches = matchCredentialsByDomain('google.com', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('2');
  });

  it('should return empty array when no matches', () => {
    const matches = matchCredentialsByDomain('netflix.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should only match credential type items', () => {
    const matches = matchCredentialsByDomain('note.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should not match unrelated domains with substring overlap', () => {
    const items = [
      {
        id: '1',
        type: 'credential',
        name: 'IT Portal',
        username: 'u',
        password: 'p',
        url: 'https://it.company.com',
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByDomain('github.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should handle credentials without URL', () => {
    const noUrl = [
      {
        id: '4',
        type: 'credential',
        name: 'NoURL',
        username: 'u',
        password: 'p',
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByDomain('example.com', noUrl);
    expect(matches).toHaveLength(0);
  });

  it('should match credentials across different subdomains of the same base domain', () => {
    const googleItems: VaultItem[] = [
      {
        id: 'g1',
        type: 'credential',
        name: 'Google Account',
        username: 'user',
        password: 'pass',
        url: 'https://accounts.google.com',
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByDomain('mail.google.com', googleItems);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('g1');
  });

  it('should not match different registrable domains even with similar names', () => {
    const items: VaultItem[] = [
      {
        id: 'g1',
        type: 'credential',
        name: 'Google',
        username: 'user',
        password: 'pass',
        url: 'https://google.com',
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByDomain('notgoogle.com', items);
    expect(matches).toHaveLength(0);
  });

  it('should not match across different TLDs', () => {
    const items: VaultItem[] = [
      {
        id: 'g1',
        type: 'credential',
        name: 'Google',
        username: 'user',
        password: 'pass',
        url: 'https://google.com',
        tags: [],
        favorite: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as VaultItem,
    ];
    const matches = matchCredentialsByDomain('google.co.uk', items);
    expect(matches).toHaveLength(0);
  });
});

describe('matchCredentialsByAppIdentifier', () => {
  const items: VaultItem[] = [
    {
      id: '1',
      type: 'credential',
      name: 'Slack',
      username: 'user',
      password: 'pass',
      url: 'https://slack.com',
      appIdentifiers: ['com.slack.android', 'com.tinyspeck.chatlyio'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2',
      type: 'credential',
      name: 'GitHub',
      username: 'user',
      password: 'pass',
      url: 'https://github.com',
      appIdentifiers: ['com.github.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3',
      type: 'credential',
      name: 'No App IDs',
      username: 'user',
      password: 'pass',
      url: 'https://example.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '4',
      type: 'secure-note',
      name: 'Secret Note',
      content: 'secret stuff',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '5',
      type: 'credential',
      name: 'Slack Work',
      username: 'work-user',
      password: 'work-pass',
      url: 'https://slack.com',
      appIdentifiers: ['com.slack.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match by exact app identifier', () => {
    const matches = matchCredentialsByAppIdentifier('com.github.android', items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('2');
  });

  it('should match case-insensitively', () => {
    const matches = matchCredentialsByAppIdentifier('COM.SLACK.ANDROID', items);
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain('1');
    expect(ids).toContain('5');
  });

  it('should return empty when no match', () => {
    const matches = matchCredentialsByAppIdentifier('com.unknown.app', items);
    expect(matches).toHaveLength(0);
  });

  it('should skip items without appIdentifiers', () => {
    const matches = matchCredentialsByAppIdentifier('com.slack.android', items);
    const ids = matches.map((m) => m.id);
    expect(ids).not.toContain('3');
  });

  it('should skip non-credential items', () => {
    const matches = matchCredentialsByAppIdentifier('com.slack.android', items);
    const ids = matches.map((m) => m.id);
    expect(ids).not.toContain('4');
  });

  it('should return multiple matches when multiple credentials share same app ID', () => {
    const matches = matchCredentialsByAppIdentifier('com.slack.android', items);
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain('1');
    expect(ids).toContain('5');
  });
});

describe('matchCredentials', () => {
  const items: VaultItem[] = [
    {
      id: '1',
      type: 'credential',
      name: 'Slack',
      username: 'user',
      password: 'pass',
      url: 'https://slack.com',
      appIdentifiers: ['com.slack.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '2',
      type: 'credential',
      name: 'GitHub',
      username: 'user',
      password: 'pass',
      url: 'https://github.com',
      appIdentifiers: ['com.github.android'],
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
    {
      id: '3',
      type: 'credential',
      name: 'Google',
      username: 'user',
      password: 'pass',
      url: 'https://google.com',
      tags: [],
      favorite: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as VaultItem,
  ];

  it('should match by app identifier only when no hostname provided', () => {
    const matches = matchCredentials({ appIdentifier: 'com.github.android' }, items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('2');
  });

  it('should match by hostname only when no appIdentifier provided', () => {
    const matches = matchCredentials({ hostname: 'google.com' }, items);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('3');
  });

  it('should combine app ID and hostname matches, deduplicated by item ID', () => {
    const matches = matchCredentials(
      { appIdentifier: 'com.slack.android', hostname: 'github.com' },
      items,
    );
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.id);
    expect(ids).toContain('1');
    expect(ids).toContain('2');
  });

  it('should return empty when no context provided', () => {
    const matches = matchCredentials({}, items);
    expect(matches).toHaveLength(0);
  });

  it('should return empty when nothing matches', () => {
    const matches = matchCredentials(
      { appIdentifier: 'com.unknown.app', hostname: 'unknown.com' },
      items,
    );
    expect(matches).toHaveLength(0);
  });

  it('should deduplicate: item matching both app ID and domain appears only once', () => {
    const matches = matchCredentials(
      { appIdentifier: 'com.slack.android', hostname: 'slack.com' },
      items,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe('1');
  });
});

// Cross-platform fixture tests. Source of truth at
// packages/core/src/domain/__fixtures__/domain-match.json. The Swift
// runner at apps/mobile/targets/credential-provider/__tests__/DomainMatcherRunner
// consumes the same file. A case that passes here but fails there (or
// vice versa) is a cross-platform divergence bug, not a fixture issue.
import fixture from './__fixtures__/domain-match.json' with { type: 'json' };

describe('cross-platform fixture (spec)', () => {
  const now = new Date().toISOString();
  const baseCred = {
    type: 'credential' as const,
    name: 'test',
    username: 'u',
    password: 'p',
    tags: [] as string[],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };

  describe('domain_cases', () => {
    for (const c of fixture.domain_cases) {
      it(`${c.id}: ${c.stored_url} vs ${c.query_host} → ${c.should_match}`, () => {
        const storedItem = {
          ...baseCred,
          id: c.id,
          url: c.stored_url,
        } as VaultItem;
        const matches = matchCredentialsByDomain(c.query_host, [storedItem]);
        expect(matches.length === 1).toBe(c.should_match);
      });
    }
  });

  describe('app_identifier_cases', () => {
    for (const c of fixture.app_identifier_cases) {
      it(`${c.id}: ${c.query_bundle_id} → ${c.should_match}`, () => {
        const storedItem = {
          ...baseCred,
          id: c.id,
          appIdentifiers: c.credential_app_ids,
        } as VaultItem;
        const matches = matchCredentialsByAppIdentifier(c.query_bundle_id, [storedItem]);
        expect(matches.length === 1).toBe(c.should_match);
      });
    }
  });
});
