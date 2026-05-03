import { getE2eCsvImportFixture } from '../../lib/e2e-import-fixture';

describe('getE2eCsvImportFixture', () => {
  it('returns null when the E2E import fixture flag is not enabled', () => {
    expect(
      getE2eCsvImportFixture('file:///documents/', {
        EXPO_PUBLIC_E2E_IMPORT_FIXTURE: '0',
      }),
    ).toBeNull();
  });

  it('returns the chrome CSV fixture in app documents when the flag is enabled', () => {
    expect(
      getE2eCsvImportFixture('file:///documents/', {
        EXPO_PUBLIC_E2E_IMPORT_FIXTURE: '1',
      }),
    ).toEqual({
      name: 'chrome.csv',
      uri: 'file:///documents/e2e/fixtures/password-imports/chrome.csv',
    });
  });

  it('returns the fixture when the app config E2E flag is enabled', () => {
    expect(
      getE2eCsvImportFixture(
        'file:///documents/',
        {
          EXPO_PUBLIC_E2E_IMPORT_FIXTURE: undefined,
        },
        true,
      ),
    ).toEqual({
      name: 'chrome.csv',
      uri: 'file:///documents/e2e/fixtures/password-imports/chrome.csv',
    });
  });
});
