const fs = require('node:fs');
const path = require('node:path');

function readPluginSource(fileName: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'plugins/autofill-service/android', fileName),
    'utf8',
  );
}

describe('Android autofill SecureStore PIN attempt handling', () => {
  it('writes native SecureStore values with the same alias shape the reader expects', () => {
    const source = readPluginSource('SecureStoreReader.kt');

    expect(source).toContain('DEFAULT_KEYCHAIN_SERVICE = "key_v1"');
    expect(source).toContain(
      'extendedKeyStoreAlias(DEFAULT_KEYCHAIN_SERVICE, requiresAuth = false)',
    );
    expect(source).toContain('put("keystoreAlias", DEFAULT_KEYCHAIN_SERVICE)');
    expect(source).toContain('put("usesKeystoreSuffix", true)');
    expect(source).toContain('put("requireAuthentication", false)');
  });

  it('does not treat an unreadable existing PIN attempt counter as a fresh counter', () => {
    const source = readPluginSource('AuthActivity.kt');

    expect(source).toContain('readPinAttemptsRemaining()');
    expect(source).toContain('SecureStoreReader.exists(this, "pin_attempts")');
    expect(source).toContain('PIN attempts counter exists but could not be read');
    expect(source).toContain('showMasterPasswordUI()');
  });
});
