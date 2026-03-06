import { describe, it, expect } from 'vitest';
import { parseICloudCsv } from './icloud.js';

// Test data based on real iCloud/Apple Passwords export format
const ICLOUD_CSV = `Title,URL,Username,Password,Notes,OTPAuth
a1.net (user@email.com),http://a1.net/,user@email.com,pass1,,
backoffice.example.pt (user@email.com),https://backoffice.example.pt/,user@email.com,pass2,,
account.acer.com (user@email.com),https://account.acer.com/,user@email.com,pass3,,
www.acesso.gov.pt (112652158),https://www.acesso.gov.pt/,112652158,pass4,,
sso.acp.pt (user@email.com),https://sso.acp.pt/,user@email.com,pass5,,
totp-site.com (user@email.com),https://totp-site.com/,user@email.com,pass6,A secure note,otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP
empty-password (nopass),https://nopass.example.com/,nopass,,,
`;

describe('iCloud CSV importer', () => {
  it('parses standard iCloud/Apple Passwords export', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    expect(items.length).toBe(7);
  });

  it('uses Title as the item name (includes username context)', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    expect(items[0].name).toBe('a1.net (user@email.com)');
    expect(items[3].name).toBe('www.acesso.gov.pt (112652158)');
  });

  it('normalizes URLs', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    expect(items[0].url).toBe('http://a1.net');
    expect(items[2].url).toBe('https://account.acer.com');
  });

  it('preserves username and password', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    expect(items[0].username).toBe('user@email.com');
    expect(items[0].password).toBe('pass1');
  });

  it('supports numeric usernames (government IDs)', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    const gov = items.find((i) => i.username === '112652158');
    expect(gov).toBeDefined();
    expect(gov?.password).toBe('pass4');
  });

  it('preserves notes', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    const withNote = items.find((i) => i.name.includes('totp-site'));
    expect(withNote?.notes).toBe('A secure note');
  });

  it('preserves OTPAuth (TOTP) values', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    const withTotp = items.find((i) => i.name.includes('totp-site'));
    expect(withTotp?.totp).toContain('otpauth://totp/');
    expect(withTotp?.totp).toContain('JBSWY3DPEHPK3PXP');
  });

  it('imports entries with password but empty username', () => {
    // The "empty-password" entry has a username "nopass" but empty password
    const { items } = parseICloudCsv(ICLOUD_CSV);
    const entry = items.find((i) => i.name.includes('empty-password'));
    expect(entry).toBeDefined();
    expect(entry?.username).toBe('nopass');
  });

  it('skips entries with no username AND no password', () => {
    const csv = `Title,URL,Username,Password,Notes,OTPAuth
empty,https://empty.com/,,,,
`;
    const { items, skipped } = parseICloudCsv(csv);
    expect(items).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toContain('No username or password');
  });

  it('throws on invalid headers', () => {
    expect(() => parseICloudCsv('foo,bar,baz\n1,2,3')).toThrow('Invalid iCloud CSV');
  });

  it('sets empty folder (iCloud has no folder concept)', () => {
    const { items } = parseICloudCsv(ICLOUD_CSV);
    for (const item of items) {
      expect(item.folder).toBe('');
    }
  });
});
