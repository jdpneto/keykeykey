#!/usr/bin/env node

/**
 * Post-`expo prebuild` patches that must run after Expo's plugin pipeline
 * completes — specifically, after `@bacons/apple-targets` emits the Podfile
 * target-loader block.
 *
 * Keep this in sync with `plugins/ios-build-fixes/index.js`. The plugin
 * handles everything Expo's mod pipeline can reach; this script handles
 * the one piece (target-name resolution in the @bacons loader) that the
 * plugin can't, because the loader is written later in the pipeline than
 * any `withDangerousMod('ios')` call can observe.
 */

const fs = require('node:fs');
const path = require('node:path');

const repoMobile = path.resolve(__dirname, '..');
const podfile = path.join(repoMobile, 'ios', 'Podfile');
const pbxproj = path.join(repoMobile, 'ios', 'KeyKeyKey.xcodeproj', 'project.pbxproj');

if (!fs.existsSync(podfile)) {
  console.log('[post-prebuild-ios] no Podfile at ' + podfile + ', skipping');
  process.exit(0);
}

let contents = fs.readFileSync(podfile, 'utf8');

// Patch `@bacons/apple-targets` extension loader to use the `name` from
// each target's `expo-target.config.js`, rather than the directory basename.
// Xcode uses the config's PascalCase `name` (e.g. "CredentialProvider"),
// so the loop's default (basename of "credential-provider") fails to match.
const needle = '  target_name = File.basename(File.dirname(target_file))\n';
if (contents.includes(needle) && !contents.includes('XCODE26_PATCH target_name')) {
  const replacement =
    '  # XCODE26_PATCH target_name: prefer `name` from expo-target.config.js\n' +
    '  target_dir = File.dirname(target_file)\n' +
    '  target_name = File.basename(target_dir)\n' +
    "  config_file = File.join(target_dir, 'expo-target.config.js')\n" +
    '  if File.exist?(config_file)\n' +
    "    if m = File.read(config_file).match(/name:\\s*['\"]([^'\"]+)['\"]/)\n" +
    '      target_name = m[1]\n' +
    '    end\n' +
    '  end\n';
  contents = contents.replace(needle, replacement);
  fs.writeFileSync(podfile, contents);
  console.log('[post-prebuild-ios] patched Podfile target-name resolution');
} else if (contents.includes('XCODE26_PATCH target_name')) {
  console.log('[post-prebuild-ios] Podfile already patched');
} else {
  console.log(
    '[post-prebuild-ios] target-name needle not found — Podfile format may have changed',
  );
}

// Exclude CredentialProvider from implicit dependency builds.
//
// CLAUDE.md describes the extension as "currently excluded from the build
// scheme due to unresolved libsodium xcframework linking." That linking bug
// is fixed by plugins/ios-build-fixes' post_install; however the extension
// also compiles SwiftUI that triggers SwiftUICore auto-link, which Apple
// rejects for app extensions ("cannot link directly with 'SwiftUICore'
// because product being built is not an allowed client of it").
//
// Rather than remove CredentialProvider from the pbxproj (which breaks
// CocoaPods' host-target consistency checks), flip `buildImplicitDependencies`
// from "YES" to "NO" on the shared scheme so `xcodebuild -scheme KeyKeyKey`
// only builds KeyKeyKey itself. To build the extension once its SwiftUI
// refactor lands, toggle the flag back, or build the CredentialProvider
// scheme directly.
const schemePath = path.join(
  repoMobile,
  'ios',
  'KeyKeyKey.xcodeproj',
  'xcshareddata',
  'xcschemes',
  'KeyKeyKey.xcscheme',
);
if (fs.existsSync(schemePath)) {
  const schemeBefore = fs.readFileSync(schemePath, 'utf8');
  const schemeAfter = schemeBefore.replace(
    'buildImplicitDependencies = "YES"',
    'buildImplicitDependencies = "NO"',
  );
  if (schemeAfter !== schemeBefore) {
    fs.writeFileSync(schemePath, schemeAfter);
    console.log(
      '[post-prebuild-ios] set buildImplicitDependencies = "NO" on KeyKeyKey.xcscheme',
    );
  }
}
