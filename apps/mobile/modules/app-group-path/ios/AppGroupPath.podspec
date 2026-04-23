Pod::Spec.new do |s|
  s.name           = 'AppGroupPath'
  s.version        = '1.0.0'
  s.summary        = 'App Group container path + shared keychain helpers'
  s.description    = 'Exposes iOS-only helpers for reading the App Group container path and the KeychainAccessGroup Info.plist entry stamped by post-prebuild-ios.js.'
  s.author         = 'KeyKeyKey'
  s.homepage       = 'https://keykeykey.com'
  s.license        = { type: 'MIT' }
  s.platforms      = { ios: '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,swift}'
end
