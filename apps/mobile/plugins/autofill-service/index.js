const { withAndroidManifest } = require('expo/config-plugins');
const path = require('path');
const fs = require('fs');

function withAutofillService(config) {
  // Register AutofillService in AndroidManifest.xml
  config = withAndroidManifest(config, (mod) => {
    const mainApplication = mod.modResults.manifest.application?.[0];
    if (!mainApplication) return mod;

    if (!mainApplication.service) mainApplication.service = [];

    const serviceExists = mainApplication.service.some(
      (s) => s.$?.['android:name'] === '.AutofillServiceImpl',
    );

    if (!serviceExists) {
      mainApplication.service.push({
        $: {
          'android:name': '.AutofillServiceImpl',
          'android:permission': 'android.permission.BIND_AUTOFILL_SERVICE',
          'android:exported': 'true',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.service.autofill.AutofillService' } }],
          },
        ],
        'meta-data': [
          {
            $: { 'android:name': 'android.autofill', 'android:resource': '@xml/autofill_service' },
          },
        ],
      });
    }
    return mod;
  });

  // Copy Kotlin source and XML resource during prebuild
  config = withAndroidManifest(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const androidSrcDir = path.join(projectRoot, 'android/app/src/main/java/com/keykeykey/app');
    const androidResDir = path.join(projectRoot, 'android/app/src/main/res/xml');

    if (!fs.existsSync(androidSrcDir)) fs.mkdirSync(androidSrcDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, 'android/AutofillServiceImpl.kt'),
      path.join(androidSrcDir, 'AutofillServiceImpl.kt'),
    );

    if (!fs.existsSync(androidResDir)) fs.mkdirSync(androidResDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, 'android/autofill_service.xml'),
      path.join(androidResDir, 'autofill_service.xml'),
    );
    return mod;
  });

  return config;
}

module.exports = withAutofillService;
