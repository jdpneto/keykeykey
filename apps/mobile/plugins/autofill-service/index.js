const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');
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
    // Register AuthActivity
    if (!mainApplication.activity) mainApplication.activity = [];
    const activityExists = mainApplication.activity.some(
      (a) => a.$?.['android:name'] === '.AuthActivity',
    );
    if (!activityExists) {
      mainApplication.activity.push({
        $: {
          'android:name': '.AuthActivity',
          'android:theme': '@android:style/Theme.DeviceDefault.Light.NoActionBar',
          'android:exported': 'false',
        },
      });
    }

    return mod;
  });

  // Copy Kotlin source and XML resource during prebuild
  config = withAndroidManifest(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const androidSrcDir = path.join(projectRoot, 'android/app/src/main/java/com/keykeykey/app');
    const androidResDir = path.join(projectRoot, 'android/app/src/main/res/xml');
    const androidAssetsDir = path.join(projectRoot, 'android/app/src/main/assets');

    if (!fs.existsSync(androidSrcDir)) fs.mkdirSync(androidSrcDir, { recursive: true });
    for (const file of fs.readdirSync(path.join(__dirname, 'android'))) {
      if (file.endsWith('.kt')) {
        fs.copyFileSync(path.join(__dirname, 'android', file), path.join(androidSrcDir, file));
      }
    }

    if (!fs.existsSync(androidResDir)) fs.mkdirSync(androidResDir, { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, 'android/autofill_service.xml'),
      path.join(androidResDir, 'autofill_service.xml'),
    );

    // Public Suffix List data file — shared with the iOS credential provider
    // (single canonical copy lives in the iOS target dir to avoid drift). The
    // Android DomainMatcher loads this from assets at startup so eTLD+1
    // matching is bit-identical to iOS.
    if (!fs.existsSync(androidAssetsDir)) fs.mkdirSync(androidAssetsDir, { recursive: true });
    const pslSource = path.join(
      projectRoot,
      'targets/credential-provider/public_suffix_list.dat',
    );
    if (fs.existsSync(pslSource)) {
      fs.copyFileSync(pslSource, path.join(androidAssetsDir, 'public_suffix_list.dat'));
    } else {
      console.warn(
        '[autofill-service] public_suffix_list.dat missing at',
        pslSource,
        '- Android domain matching will fall back to exact-host equality only.',
      );
    }
    return mod;
  });

  // Add lazysodium native crypto dependencies
  config = withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes('lazysodium-android')) {
      mod.modResults.contents = mod.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    implementation 'com.goterl:lazysodium-android:5.1.0:@aar'\n    implementation 'net.java.dev.jna:jna:5.14.0@aar'`,
      );
    }
    return mod;
  });

  return config;
}

module.exports = withAutofillService;
