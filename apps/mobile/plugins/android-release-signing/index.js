const { withAppBuildGradle } = require('expo/config-plugins');

const signingHelperMarker = 'def keykeykeyUploadSigningProperty = { name ->';

const signingHelper = `def keykeykeyUploadSigningProperty = { name ->
    def value = findProperty(name) ?: System.getenv(name)
    return value == null ? null : value.toString()
}

def keykeykeyUploadStoreFile = keykeykeyUploadSigningProperty('KEYKEYKEY_UPLOAD_STORE_FILE')
def keykeykeyUploadStorePassword = keykeykeyUploadSigningProperty('KEYKEYKEY_UPLOAD_STORE_PASSWORD')
def keykeykeyUploadKeyAlias = keykeykeyUploadSigningProperty('KEYKEYKEY_UPLOAD_KEY_ALIAS')
def keykeykeyUploadKeyPassword = keykeykeyUploadSigningProperty('KEYKEYKEY_UPLOAD_KEY_PASSWORD')
def keykeykeyHasUploadSigning = [
    keykeykeyUploadStoreFile,
    keykeykeyUploadStorePassword,
    keykeykeyUploadKeyAlias,
    keykeykeyUploadKeyPassword
].every { it != null && it.trim().length() > 0 }
def keykeykeyReleaseTaskRequested = gradle.startParameter.taskNames.any {
    def taskName = it.toLowerCase()
    taskName.contains('release') && (
        taskName.contains('assemble') ||
        taskName.contains('bundle') ||
        taskName.contains('install') ||
        taskName.contains('package') ||
        taskName.contains('sign')
    )
}

if (keykeykeyReleaseTaskRequested && !keykeykeyHasUploadSigning) {
    throw new GradleException(
        'Release signing requires KEYKEYKEY_UPLOAD_STORE_FILE, KEYKEYKEY_UPLOAD_STORE_PASSWORD, ' +
        'KEYKEYKEY_UPLOAD_KEY_ALIAS, and KEYKEYKEY_UPLOAD_KEY_PASSWORD in ~/.gradle/gradle.properties ' +
        'or the environment. Refusing to build a debug-signed release artifact.'
    )
}`;

const debugSigningBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;

const uploadSigningBlock = `        if (keykeykeyHasUploadSigning) {
            release {
                storeFile file(keykeykeyUploadStoreFile)
                storePassword keykeykeyUploadStorePassword
                keyAlias keykeykeyUploadKeyAlias
                keyPassword keykeykeyUploadKeyPassword
            }
        }`;

const generatedReleaseDebugSigning = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const releaseUploadSigning = `            if (keykeykeyHasUploadSigning) {
                signingConfig signingConfigs.release
            }`;

function replaceOrThrow(contents, anchor, replacement, what) {
  if (!contents.includes(anchor)) {
    // Fail the prebuild instead of silently emitting a build.gradle that
    // references undefined signing variables (or, worse, debug-signs release).
    throw new Error(`android-release-signing: could not find ${what} in app/build.gradle`);
  }
  return contents.replace(anchor, replacement);
}

function ensureReleaseSigning(contents) {
  let next = contents;

  if (!next.includes(signingHelperMarker)) {
    // Anchor on the top-level `android {` block — the helper must be defined
    // before signingConfigs reads it. (SDK 52 anchored on the jscFlavor line,
    // which the template dropped along with JSC.)
    const androidBlock = next.match(/^android \{$/m);
    if (!androidBlock) {
      throw new Error('android-release-signing: could not find `android {` in app/build.gradle');
    }
    next = next.replace(/^android \{$/m, `${signingHelper}\n\nandroid {`);
  }

  if (!next.includes('release {\n                storeFile file(keykeykeyUploadStoreFile)')) {
    next = replaceOrThrow(
      next,
      debugSigningBlock,
      `${debugSigningBlock}\n${uploadSigningBlock}`,
      'the debug signingConfig block',
    );
  }

  if (!next.includes(releaseUploadSigning)) {
    next = replaceOrThrow(
      next,
      generatedReleaseDebugSigning,
      releaseUploadSigning,
      'the release buildType debug signingConfig',
    );
  }

  return next;
}

function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = ensureReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withAndroidReleaseSigning;
module.exports.ensureReleaseSigning = ensureReleaseSigning;
