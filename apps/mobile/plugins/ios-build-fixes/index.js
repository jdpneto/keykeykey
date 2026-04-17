/**
 * Expo config plugin that patches the generated iOS Podfile at prebuild time
 * and injects a post_install hook covering the five Xcode 26 / RN 0.76 build
 * infrastructure issues that otherwise require manual patches after every
 * `expo prebuild`:
 *
 *   1. `@bacons/apple-targets` extension loader uses directory basenames
 *      (`credential-provider`) while Xcode uses the PascalCase target name
 *      (`CredentialProvider`). Patch the target loop to read the `name`
 *      field from `expo-target.config.js`.
 *
 *   2. `FMT_USE_CONSTEVAL=0` preprocessor flag on every pod target — fmt
 *      11.0.2 (bundled by Folly / RN 0.76) uses consteval templates that
 *      fail to evaluate under Xcode 26's Clang.
 *
 *   3. Patch `Pods/fmt/include/fmt/base.h` so the consteval-detection
 *      block respects the predefine (by default it unconditionally sets
 *      `FMT_USE_CONSTEVAL = 1` when `__cpp_consteval` is defined).
 *
 *   4. Add `${PODS_ROOT}/Argon2Swift/Sources/Modules` to the `RNArgon2` and
 *      `Argon2Swift` targets' `SWIFT_INCLUDE_PATHS` so `import argon2` in
 *      Swift resolves. Same issue documented in CLAUDE.md.
 *
 *   5. Add `${PODS_XCFRAMEWORKS_BUILD_DIR}/Clibsodium` to the
 *      `CredentialProvider` target's `LIBRARY_SEARCH_PATHS` so the
 *      `libsodium.a` inside `Clibsodium.xcframework` is visible to the
 *      linker (the stock xcconfig adds the path under the name `Sodium`,
 *      which doesn't match the actual xcframework directory).
 *
 * The patches are idempotent — re-running `expo prebuild` will re-apply
 * them onto the freshly generated Podfile.
 *
 * The separate Xcode 26 `objectVersion = 70` issue is handled by a
 * Ruby monkey-patch loaded at the top of the generated Podfile (see
 * the block prepended below). That patch augments the xcodeproj gem's
 * compatibility table in-process, so it works with any xcodeproj 1.27.x
 * without requiring a Gemfile.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PODFILE_MARKER = '# keykeykey-ios-build-fixes v1';

function withIosBuildFixes(config) {
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
        "# 56, 60, 63, 77 — Xcode 26 writes 70. Add it at load time so",
        '# `pod install` does not raise "Unable to find compatibility version',
        '# string for object version `70`".',
        "require 'xcodeproj/constants'",
        'unless Xcodeproj::Constants::COMPATIBILITY_VERSION_BY_OBJECT_VERSION.key?(70)',
        "  Xcodeproj::Constants.send(:remove_const, :COMPATIBILITY_VERSION_BY_OBJECT_VERSION)",
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

      // Inject the build-fixes block inside the main target's
      //    `post_install` (after the existing CODE_SIGNING_ALLOWED block).
      const postInstallAnchor = [
        'installer.target_installation_results.pod_target_installation_results',
        '      .each do |pod_name, target_installation_result|',
        '      target_installation_result.resource_bundle_targets.each do |resource_bundle_target|',
        '        resource_bundle_target.build_configurations.each do |config|',
        "          config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'",
        '        end',
        '      end',
        '    end',
      ].join('\n');

      const postInstallBlock = [
        '',
        '    # --- keykeykey-ios-build-fixes (injected by plugins/ios-build-fixes) ---',
        '    # Xcode 26: patch Pods/fmt/include/fmt/base.h so the FMT_USE_CONSTEVAL',
        '    # predefine we set below actually sticks. Without this, fmt unconditionally',
        '    # flips the flag to 1 via `#elif defined(__cpp_consteval)` in newer Clangs.',
        "    fmt_base = File.join(installer.sandbox.pod_dir('fmt'), 'include', 'fmt', 'base.h')",
        '    if File.exist?(fmt_base)',
        '      original = File.read(fmt_base)',
        "      unless original.include?('XCODE26_PATCH FMT_USE_CONSTEVAL')",
        '        # Wrap the FMT_USE_CONSTEVAL detection block in #ifndef / #endif.',
        "        patched = original.sub(",
        "          '// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.',",
        "          \"// Detect consteval, C++20 constexpr extensions and std::is_constant_evaluated.\\n// XCODE26_PATCH: respect predefined FMT_USE_CONSTEVAL from -D flag.\\n#ifndef FMT_USE_CONSTEVAL\"",
        '        )',
        '        # Close the #ifndef we just opened, just before the next block',
        "        # (which starts with `#if FMT_USE_CONSTEVAL`).",
        "        patched = patched.sub(",
        "          /(\\n#if FMT_USE_CONSTEVAL\\n)/,",
        "          \"\\n#endif // XCODE26_PATCH FMT_USE_CONSTEVAL\\\\1\"",
        '        )',
        '        File.write(fmt_base, patched)',
        '        puts "[ios-build-fixes] patched #{fmt_base}"',
        '      end',
        '    end',
        '',
        '    installer.pods_project.targets.each do |t|',
        '      t.build_configurations.each do |config|',
        "        defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']",
        '        defs = [defs] unless defs.is_a?(Array)',
        "        unless defs.join(' ').include?('FMT_USE_CONSTEVAL')",
        "          defs << 'FMT_USE_CONSTEVAL=0'",
        "          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs",
        '        end',
        '',
        '        # RNArgon2 / Argon2Swift: expose the argon2 C module to Swift.',
        "        if t.name == 'RNArgon2' || t.name == 'Argon2Swift'",
        "          includes = config.build_settings['SWIFT_INCLUDE_PATHS'] || '$(inherited)'",
        "          unless includes.include?('Argon2Swift/Sources/Modules')",
        "            config.build_settings['SWIFT_INCLUDE_PATHS'] = \"#{includes} ${PODS_ROOT}/Argon2Swift/Sources/Modules\"",
        '          end',
        '        end',
        '',
        "        # Pods-CredentialProvider: point the linker at Clibsodium.xcframework's",
        '        # intermediate build dir so -lsodium resolves. The default xcconfig adds',
        '        # "Sodium" but not "Clibsodium" to LIBRARY_SEARCH_PATHS.',
        "        if t.name == 'Pods-CredentialProvider' || t.name == 'CredentialProvider'",
        "          libs = config.build_settings['LIBRARY_SEARCH_PATHS'] || '$(inherited)'",
        "          libs = libs.is_a?(Array) ? libs.join(' ') : libs",
        "          unless libs.include?('Clibsodium')",
        "            config.build_settings['LIBRARY_SEARCH_PATHS'] = \"#{libs} ${PODS_XCFRAMEWORKS_BUILD_DIR}/Clibsodium\"",
        '          end',
        '        end',
        '      end',
        '    end',
        '    # --- end keykeykey-ios-build-fixes ---',
      ].join('\n');

      if (contents.includes(postInstallAnchor)) {
        contents = contents.replace(
          postInstallAnchor,
          postInstallAnchor + '\n' + postInstallBlock,
        );
      }

      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);
}

module.exports = withIosBuildFixes;
