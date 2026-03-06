import { describe, it, expect } from 'vitest';
import { parseFirefoxCsv } from './firefox.js';

// Test data based on real Firefox export format
const FIREFOX_CSV = `"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
"chrome://FirefoxAccounts","8e6117d643b5416c","{""version"":1,""accountData"":{""scopedKeys"":{}}}","Firefox Accounts credentials",,"{adcca1df-c96a-4dea-b65f-cc2ce2d55e3f}","1679651000041","1679651000041","1698517506447"
"https://accounts.firefox.com","user@email.com","firefoxpass",,"https://accounts.firefox.com","1EcmCCn9kY99","1679651004205","1679651004205","1679651004205"
"https://www.amazon.it","user@email.com","amazonpass",,"https://www.amazon.it","{b0e360dd-ff4f-4210-83ef-d789d5d2a991}","1448131765179","1448131765179","1448131765179"
"https://inforestudante.uc.pt","student@student.uc.pt","ucpass",,"https://inforestudante.uc.pt","{b9893391-9659-4c54-bdfd-56540992e25e}","1350385642000","1350385642000","1350385642000"
"http://192.168.1.2","admin","routerpass",,"http://192.168.1.2","{14e245ae-747a-4891-ac1d-b4ee58ea618c}","1510709491536","1510709491536","1510709491536"
"https://www.acp.pt","user@email.com","acppass",,"https://www.acp.pt","{42fb279d-dee7-4bfd-b009-148b7bda9745}","1644356876201","1644356876201","1644356876201"
`;

describe('Firefox CSV importer', () => {
  it('parses standard Firefox export entries', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    expect(items.length).toBe(5);
  });

  it('skips internal Firefox Accounts entry (chrome:// URL)', () => {
    const { skipped } = parseFirefoxCsv(FIREFOX_CSV);
    const ffEntry = skipped.find((s) => s.reason.includes('Internal Firefox entry'));
    expect(ffEntry).toBeDefined();
  });

  it('skips entries with JSON sync metadata as password', () => {
    // The chrome://FirefoxAccounts row has a JSON password AND chrome:// URL
    // It gets caught by the chrome:// check first, but let's test the JSON check directly
    const csvWithJsonPassword = `"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"
"https://example.com","syncuser","{""version"":1,""data"":{}}","Sync",,"guid1","1","1","1"
`;
    const { items, skipped } = parseFirefoxCsv(csvWithJsonPassword);
    expect(items).toHaveLength(0);
    expect(skipped[0].reason).toContain('JSON password');
  });

  it('derives name from URL hostname', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    const amazon = items.find((i) => i.name === 'www.amazon.it');
    expect(amazon).toBeDefined();
  });

  it('preserves username and password', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    const amazon = items.find((i) => i.name === 'www.amazon.it');
    expect(amazon?.username).toBe('user@email.com');
    expect(amazon?.password).toBe('amazonpass');
  });

  it('handles HTTP URLs (non-HTTPS)', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    const router = items.find((i) => i.name === '192.168.1.2');
    expect(router).toBeDefined();
    expect(router?.url).toBe('http://192.168.1.2');
  });

  it('normalizes URLs', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    const acp = items.find((i) => i.name === 'www.acp.pt');
    expect(acp?.url).toBe('https://www.acp.pt');
  });

  it('sets empty notes (Firefox export has no notes column)', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    for (const item of items) {
      expect(item.notes).toBe('');
    }
  });

  it('throws on invalid headers', () => {
    expect(() => parseFirefoxCsv('foo,bar,baz\n1,2,3')).toThrow('Invalid Firefox CSV');
  });

  it('handles quoted fields with special characters', () => {
    const { items } = parseFirefoxCsv(FIREFOX_CSV);
    // All Firefox exports use quoted fields — verify they're unquoted properly
    expect(items[0].url).not.toContain('"');
  });
});
