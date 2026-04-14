import { describe, it, expect } from 'vitest';
import { classifyUri } from './classify-uri.js';

describe('classifyUri', () => {
  describe('drop', () => {
    it('drops empty string', () => {
      expect(classifyUri('')).toEqual({ kind: 'drop' });
    });

    it('drops whitespace-only string', () => {
      expect(classifyUri('   \t\n  ')).toEqual({ kind: 'drop' });
    });

    it('drops unknown custom schemes', () => {
      expect(classifyUri('chrome-extension://abcdef/')).toEqual({ kind: 'drop' });
      expect(classifyUri('file:///etc/passwd')).toEqual({ kind: 'drop' });
      expect(classifyUri('javascript:alert(1)')).toEqual({ kind: 'drop' });
    });

    it('drops strings that cannot be parsed as a URL even with https:// prefix', () => {
      expect(classifyUri('not a url at all')).toEqual({ kind: 'drop' });
    });

    it('drops app URIs whose extracted id fails the reverse-DNS regex', () => {
      expect(classifyUri('androidapp://has-hyphens/')).toEqual({ kind: 'drop' });
      expect(classifyUri('androidapp://singleword/')).toEqual({ kind: 'drop' });
    });

    it('drops mailto: URIs instead of misclassifying their host (regression: hasScheme bug)', () => {
      expect(classifyUri('mailto:a@b.com')).toEqual({ kind: 'drop' });
      expect(classifyUri('tel:+1234567890')).toEqual({ kind: 'drop' });
    });
  });

  describe('appIdentifier', () => {
    it('extracts the package from androidapp:// (Bitwarden mobile)', () => {
      expect(classifyUri('androidapp://com.tesla.TeslaApp/')).toEqual({
        kind: 'appIdentifier',
        value: 'com.tesla.teslaapp',
      });
    });

    it('handles androidapp:// without trailing slash', () => {
      expect(classifyUri('androidapp://com.example.app')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });

    it('extracts the package from android://<hash>@<pkg>/ (Chrome sync format)', () => {
      expect(classifyUri('android://RkThcH70DgO3VqLlhDCC7x@net.skyscanner.android.main/')).toEqual({
        kind: 'appIdentifier',
        value: 'net.skyscanner.android.main',
      });
    });

    it('extracts the bundle id from iosapp://', () => {
      expect(classifyUri('iosapp://com.apple.mobilesafari')).toEqual({
        kind: 'appIdentifier',
        value: 'com.apple.mobilesafari',
      });
    });

    it('extracts the bundle id from ios://', () => {
      expect(classifyUri('ios://com.example.notes')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.notes',
      });
    });

    it('lowercases extracted identifiers (schema stores them lowercased)', () => {
      expect(classifyUri('androidapp://Com.Example.App/')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });

    it('handles androidapp:// with query string (regression: stops capture at ?)', () => {
      expect(classifyUri('androidapp://com.example.app?ref=x')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });

    it('handles androidapp:// with fragment (regression: stops capture at #)', () => {
      expect(classifyUri('androidapp://com.example.app#frag')).toEqual({
        kind: 'appIdentifier',
        value: 'com.example.app',
      });
    });
  });

  describe('url', () => {
    it('keeps https URLs and strips query/hash', () => {
      expect(classifyUri('https://foo.com/path?q=1#frag')).toEqual({
        kind: 'url',
        value: 'https://foo.com/path',
      });
    });

    it('keeps http URLs and drops a bare trailing slash', () => {
      expect(classifyUri('http://foo.com/')).toEqual({ kind: 'url', value: 'http://foo.com' });
    });

    it('preserves paths other than bare /', () => {
      expect(classifyUri('https://foo.com/login')).toEqual({
        kind: 'url',
        value: 'https://foo.com/login',
      });
    });

    it('prepends https:// to schemeless hostnames (regression: bug fix)', () => {
      expect(classifyUri('foo.com')).toEqual({ kind: 'url', value: 'https://foo.com' });
    });

    it('prepends https:// to schemeless hostnames with paths', () => {
      expect(classifyUri('foo.com/login')).toEqual({
        kind: 'url',
        value: 'https://foo.com/login',
      });
    });

    it('handles IP addresses with http:// scheme', () => {
      expect(classifyUri('http://192.168.1.1')).toEqual({
        kind: 'url',
        value: 'http://192.168.1.1',
      });
    });
  });
});
