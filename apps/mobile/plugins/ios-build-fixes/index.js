/**
 * Expo config plugin that patches the generated iOS Podfile at prebuild time
 * and injects a post_install hook covering the Xcode 26+ build infrastructure
 * issues that otherwise require manual patches after every `expo prebuild`:
 *
 *   1. Add `${PODS_ROOT}/Argon2Swift/Sources/Modules` to the `RNArgon2` and
 *      `Argon2Swift` targets' `SWIFT_INCLUDE_PATHS` so `import argon2` in
 *      Swift resolves.
 *
 *   2. Rewrite `Pods-CredentialProvider.{debug,release}.xcconfig` to link
 *      the Clibsodium C library by absolute path instead of `-l"sodium"`.
 *      On case-insensitive APFS (the macOS default), `-lsodium` in the
 *      search path `${PODS_CONFIGURATION_BUILD_DIR}/Sodium` matches the
 *      Swift wrapper `libSodium.a` (built from the pod's Swift sources)
 *      and the real `libsodium.a` inside `Clibsodium.xcframework` is
 *      never consulted — leaving every libsodium C symbol undefined.
 *      Replacing `-l"sodium"` with the explicit path skips the `-L`
 *      search entirely. Raises if neither form is present.
 *
 * The `@bacons/apple-targets` target-name fix lives in
 * `scripts/post-prebuild-ios.js` (see the note below).
 *
 * Removed with Expo SDK 58 / RN 0.88: the fmt `FMT_USE_CONSTEVAL=0` define and
 * the `Pods/fmt/include/fmt/base.h` patch. fmt now ships inside the prebuilt
 * `ReactNativeDependencies` pod (fmt 12.1, no `Pods/fmt` sources to patch), and
 * fmt 12's consteval detection no longer breaks under Xcode 26+/27 Clang.
 *
 * The patches are idempotent — re-running `expo prebuild` will re-apply
 * them onto the freshly generated Podfile.
 *
 * Xcode 26+ may rewrite the pbxproj with `objectVersion = 70`, which the
 * xcodeproj 1.27 gem (CocoaPods 1.16) does not know. A Ruby monkey-patch
 * prepended to the generated Podfile (see below) augments the gem's
 * compatibility table in-process, so it works without a Gemfile.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PODFILE_MARKER = '# keykeykey-ios-build-fixes v1';

function withPodfilePatches(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfile)) return cfg;

      let contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(PODFILE_MARKER)) return cfg;

      // 1. Prepend the xcodeproj compatibility monkey-patch so `pod install`
      //    survives Xcode 26's `objectVersion = 70` pbxproj format.
      const xcodeprojMonkeyPatch = [
        PODFILE_MARKER,
        '# Xcode 26 support: xcodeproj 1.27.0 only knows object versions 55,',
        '# 56, 60, 63, 77 — Xcode 26 writes 70. Add it at load time so',
        '# `pod install` does not raise "Unable to find compatibility version',
        '# string for object version `70`".',
        "require 'xcodeproj/constants'",
        'unless Xcodeproj::Constants::COMPATIBILITY_VERSION_BY_OBJECT_VERSION.key?(70)',
        '  Xcodeproj::Constants.send(:remove_const, :COMPATIBILITY_VERSION_BY_OBJECT_VERSION)',
        '  Xcodeproj::Constants::COMPATIBILITY_VERSION_BY_OBJECT_VERSION = {',
        "    77 => 'Xcode 16.0',",
        "    70 => 'Xcode 15.3',",
        "    63 => 'Xcode 15.3',",
        "    60 => 'Xcode 15.0',",
        "    56 => 'Xcode 14.0',",
        "    55 => 'Xcode 13.0',",
        "    54 => 'Xcode 12.0',",
        "    53 => 'Xcode 11.4',",
        "    52 => 'Xcode 11.0',",
        "    51 => 'Xcode 10.0',",
        "    50 => 'Xcode 9.3',",
        "    48 => 'Xcode 8.0',",
        "    47 => 'Xcode 6.3',",
        "    46 => 'Xcode 3.2',",
        "    45 => 'Xcode 3.1',",
        '  }.freeze',
        'end',
        '',
      ].join('\n');

      contents = xcodeprojMonkeyPatch + contents;

      // Note: `@bacons/apple-targets` writes its extension-loader block
      // later in the Expo plugin pipeline than any `withDangerousMod('ios')`
      // can observe, so the target-name fix (directory basename →
      // `name` from expo-target.config.js) is applied by
      // `apps/mobile/scripts/post-prebuild-ios.js` after the prebuild run
      // completes. See `apps/mobile/package.json`'s `prebuild` script.

      // Inject the build-fixes block inside the main target's `post_install`,
      // right after `react_native_post_install(...)` (which rewrites pod build
      // settings, so our overrides must come after it). SDK 52 anchored on a
      // CODE_SIGNING_ALLOWED block that SDK 57's template no longer emits —
      // the injection silently no-op'd and CredentialProvider failed to link.
      const postInstallAnchor = /react_native_post_install\([\s\S]*?\n\s*\)\n/;

      const postInstallBlock = [
        '',
        '    # --- keykeykey-ios-build-fixes (injected by plugins/ios-build-fixes) ---',
        '    installer.pods_project.targets.each do |t|',
        '      t.build_configurations.each do |config|',
        '        # RNArgon2 / Argon2Swift: expose the argon2 C module to Swift.',
        "        if t.name == 'RNArgon2' || t.name == 'Argon2Swift'",
        "          includes = config.build_settings['SWIFT_INCLUDE_PATHS'] || '$(inherited)'",
        "          unless includes.include?('Argon2Swift/Sources/Modules')",
        '            config.build_settings[\'SWIFT_INCLUDE_PATHS\'] = "#{includes} ${PODS_ROOT}/Argon2Swift/Sources/Modules"',
        '          end',
        '        end',
        '      end',
        '    end',
        '',
        '    # Pods-CredentialProvider xcconfig: replace `-l"sodium"` with the',
        '    # absolute path to libsodium.a inside Clibsodium.xcframework. On',
        '    # case-insensitive APFS, `-lsodium` collides with the Swift wrapper',
        '    # libSodium.a in ${PODS_CONFIGURATION_BUILD_DIR}/Sodium; the real',
        '    # C library is never linked, and every Clibsodium symbol is',
        '    # reported as undefined. Using an absolute path skips -L search.',
        '    # Xcodeproj re-serializes these files (dropping comments and',
        '    # reordering flags), so detect the patched state by the path itself.',
        '    %w[debug release].each do |cfg|',
        '      xcconfig = File.join(installer.sandbox.target_support_files_root,',
        "                           'Pods-CredentialProvider',",
        '                           "Pods-CredentialProvider.#{cfg}.xcconfig")',
        '      next unless File.exist?(xcconfig)',
        '      original = File.read(xcconfig)',
        '      libsodium = \'"${PODS_XCFRAMEWORKS_BUILD_DIR}/Sodium/libsodium.a"\'',
        '      if original.include?(\'-l"sodium"\')',
        '        File.write(xcconfig, original.sub(\'-l"sodium"\', libsodium))',
        '        puts "[ios-build-fixes] patched #{xcconfig}"',
        "      elsif !original.include?('/Sodium/libsodium.a')",
        '        raise "[ios-build-fixes] #{xcconfig}: found neither the -lsodium flag nor the libsodium.a path; Sodium linkage changed, update plugins/ios-build-fixes"',
        '      end',
        '    end',
        '    # --- end keykeykey-ios-build-fixes ---',
      ].join('\n');

      if (!postInstallAnchor.test(contents)) {
        throw new Error(
          'ios-build-fixes: could not find `react_native_post_install(...)` in ios/Podfile',
        );
      }
      contents = contents.replace(postInstallAnchor, (m) => m + postInstallBlock + '\n');

      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);
}

module.exports = withPodfilePatches;
