const { withAppBuildGradle, withMainActivity } = require('expo/config-plugins');

const activityKtxDependency = "    implementation 'androidx.activity:activity-ktx:1.9.3'";

function ensureActivityKtxDependency(contents) {
  if (contents.includes('androidx.activity:activity-ktx')) {
    return contents;
  }

  if (!/dependencies\s*\{/.test(contents)) {
    throw new Error('android-edge-to-edge: could not find `dependencies {` in app/build.gradle');
  }
  return contents.replace(/dependencies\s*\{/, `dependencies {\n${activityKtxDependency}`);
}

function replaceOrThrow(contents, anchor, replacement, what) {
  if (!contents.includes(anchor)) {
    throw new Error(`android-edge-to-edge: could not find ${what} in MainActivity.kt`);
  }
  return contents.replace(anchor, replacement);
}

function ensureMainActivityEdgeToEdge(contents) {
  let next = contents;

  if (!next.includes('import androidx.activity.enableEdgeToEdge')) {
    next = replaceOrThrow(
      next,
      'import android.os.Bundle\n',
      'import android.os.Bundle\n\nimport androidx.activity.enableEdgeToEdge\n',
      '`import android.os.Bundle`',
    );
  }

  if (!next.includes('enableEdgeToEdge()')) {
    next = replaceOrThrow(
      next,
      '    super.onCreate(null)',
      '    enableEdgeToEdge()\n    super.onCreate(null)',
      '`super.onCreate(null)`',
    );
  }

  return next;
}

function withAndroidEdgeToEdge(config) {
  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = ensureActivityKtxDependency(mod.modResults.contents);
    return mod;
  });

  config = withMainActivity(config, (mod) => {
    mod.modResults.contents = ensureMainActivityEdgeToEdge(mod.modResults.contents);
    return mod;
  });

  return config;
}

module.exports = withAndroidEdgeToEdge;
module.exports.ensureActivityKtxDependency = ensureActivityKtxDependency;
module.exports.ensureMainActivityEdgeToEdge = ensureMainActivityEdgeToEdge;
