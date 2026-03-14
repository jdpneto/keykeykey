import { describe, it, expect } from 'vitest';
import { extractDomainBrand, matchCredentialsByDomain, normalizeUrl } from './domain-utils.js';
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

  it('should match credentials by domain contains', () => {
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
});
