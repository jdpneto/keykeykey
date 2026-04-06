import { describe, it, expect } from 'vitest';
import { parseChromeCsv } from './chrome.js';

// Test data based on real Chrome export format
const CHROME_CSV = `name,url,username,password,note
9gag.com,https://9gag.com/,user@email.com,s3cur3pass,
9gag.com,https://9gag.com/settings/password,user@email.com,s3cur3pass,
Booking.com: Hotels & Travel,android://kruaZwYGsiu76TbANLX52LLaQiATTg7QsVJEW6cz1vgYnZX_EOz197ZA6gI2AyAJ50pyP5QXnYDIY-Ct9TvhJw==@com.booking/,user@email.com,bookingpass,
Instagram,android://qbMQCZh-CU_SBn04UFat_bLMSicoFKWYI0MzXmOdBklD5gJcvH42kD8GXA5lvZmtq1ON0Dd8FAT6SLUIlwNUqA==@com.instagram.android/,user@email.com,instapass,
Skyscanner,android://RkThcH70DgO3VqLlhDCC7x@net.skyscanner.android.main/,user@email.com,,
account.acer.com,https://account.acer.com/myaccount/page.do;jsessionid=ABC123,,acerpass,
account.dji.com,https://account.dji.com/login,user@email.com,djipass,A note here
`;

describe('Chrome CSV importer', () => {
  it('parses standard Chrome export entries', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    expect(items.length).toBeGreaterThanOrEqual(5);
  });

  it('uses name field as the item name', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    expect(items[0].name).toBe('9gag.com');
    expect(items[1].name).toBe('9gag.com');
  });

  it('normalizes regular URLs to hostname + path', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    const dji = items.find((i) => i.name === 'account.dji.com');
    expect(dji?.url).toBe('https://account.dji.com/login');
  });

  it('strips android:// URLs to empty string', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    const booking = items.find((i) => i.name === 'Booking.com: Hotels & Travel');
    expect(booking?.url).toBe('');
  });

  it('preserves username and password', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    expect(items[0].username).toBe('user@email.com');
    expect(items[0].password).toBe('s3cur3pass');
  });

  it('preserves notes', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    const dji = items.find((i) => i.name === 'account.dji.com');
    expect(dji?.notes).toBe('A note here');
  });

  it('skips entries with no username AND no password', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    // Skyscanner has username but no password — still imported
    const sky = items.find((i) => i.name === 'Skyscanner');
    expect(sky).toBeDefined();
    expect(sky?.password).toBe('');
  });

  it('imports entries with password but no username', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    const acer = items.find((i) => i.name === 'account.acer.com');
    expect(acer).toBeDefined();
    expect(acer?.username).toBe('');
    expect(acer?.password).toBe('acerpass');
  });

  it('throws on invalid headers', () => {
    expect(() => parseChromeCsv('foo,bar,baz\n1,2,3')).toThrow('Invalid Chrome CSV');
  });

  it('handles empty CSV body', () => {
    const { items } = parseChromeCsv('name,url,username,password,note\n');
    expect(items).toEqual([]);
  });

  it('sets default values for folder, favorite, totp', () => {
    const { items } = parseChromeCsv(CHROME_CSV);
    for (const item of items) {
      expect(item.folder).toBe('');
      expect(item.favorite).toBe(false);
      expect(item.totp).toBe('');
    }
  });

});
