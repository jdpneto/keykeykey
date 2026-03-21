#!/bin/bash
# Post-prebuild fixes for iOS build compatibility
set -e

IOS_DIR="$(dirname "$0")/../ios"

# 1. Fix Podfile: resolve target names from expo-target.config.js
python3 -c "
content = open('$IOS_DIR/Podfile').read()
old = '  target_name = File.basename(File.dirname(target_file))'
new = '''  dir_name = File.basename(File.dirname(target_file))
  config_file = File.join(File.dirname(target_file), 'expo-target.config.js')
  if File.exist?(config_file)
    config_content = File.read(config_file)
    match = config_content.match(/name:..(\\\\w+)../)
    target_name = match ? match[1] : dir_name
  else
    target_name = dir_name
  end'''
content = content.replace(old, new)
open('$IOS_DIR/Podfile', 'w').write(content)
print('Patched Podfile target name resolution')
"

# 2. Add Argon2 module search path fix to post_install
python3 -c "
content = open('$IOS_DIR/Podfile').read()
fix = '''
    # Fix Argon2Swift C module search path for RNArgon2
    argon2_modules_dir = File.join(installer.sandbox.root, 'Argon2Swift', 'Sources', 'Modules')
    installer.pods_project.targets.each do |target|
      if target.name == 'RNArgon2'
        target.build_configurations.each do |config|
          swift_include = config.build_settings['SWIFT_INCLUDE_PATHS'] || '\$(inherited)'
          unless swift_include.include?(argon2_modules_dir)
            config.build_settings['SWIFT_INCLUDE_PATHS'] = \"\#{swift_include} \\\\\"\#{argon2_modules_dir}\\\\\"\"
          end
        end
      end
    end'''
# Insert before the last 'end' of the post_install block
marker = \"    end\\n  end\\nend\"
content = content.replace(marker, fix + '\\n    end\\n  end\\nend', 1)
open('$IOS_DIR/Podfile', 'w').write(content)
print('Added Argon2 module search path fix')
"

echo "iOS build fixes applied"
