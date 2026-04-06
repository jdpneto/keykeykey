import { describe, it, expect } from 'vitest';
import { parseKeykeykeyCsv } from './keykeykey.js';

const KEYKEYKEY_CSV = `name,url,username,password,notes,totp,folder,favorite
My Site,https://example.com,user@test.com,pass123,some notes,otpauth://totp/Test?secret=ABC,work,true
Other,https://other.com,admin,secret,,,,false
No Creds,https://empty.com,,,,,,false
`;

describe('KeyKeyKey CSV importer', () => {
  it('parses all fields correctly', () => {
    const { items } = parseKeykeykeyCsv(KEYKEYKEY_CSV);
    expect(items).toHaveLength(2);

    expect(items[0].name).toBe('My Site');
    expect(items[0].url).toBe('https://example.com');
    expect(items[0].username).toBe('user@test.com');
    expect(items[0].password).toBe('pass123');
    expect(items[0].notes).toBe('some notes');
    expect(items[0].totp).toBe('otpauth://totp/Test?secret=ABC');
    expect(items[0].folder).toBe('work');
    expect(items[0].favorite).toBe(true);
  });

  it('handles empty optional fields', () => {
    const { items } = parseKeykeykeyCsv(KEYKEYKEY_CSV);
    expect(items[1].notes).toBe('');
    expect(items[1].totp).toBe('');
    expect(items[1].folder).toBe('');
    expect(items[1].favorite).toBe(false);
  });

  it('skips entries with no username AND no password', () => {
    const { items, skipped } = parseKeykeykeyCsv(KEYKEYKEY_CSV);
    expect(items).toHaveLength(2);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('No username or password');
  });

  it('throws on missing required headers', () => {
    expect(() => parseKeykeykeyCsv('name,url,username,password\n')).toThrow(
      'Invalid KeyKeyKey CSV',
    );
  });

  it('handles empty CSV body', () => {
    const { items } = parseKeykeykeyCsv('name,url,username,password,notes,totp,folder,favorite\n');
    expect(items).toEqual([]);
  });

  it('uses "Unnamed" for entries with no name', () => {
    const csv = `name,url,username,password,notes,totp,folder,favorite
,https://x.com,user,pass,,,,false
`;
    const { items } = parseKeykeykeyCsv(csv);
    expect(items[0].name).toBe('Unnamed');
  });
});
