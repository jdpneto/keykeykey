# @keykeykey/mobile

KeyKeyKey mobile app for iOS and Android, built with Expo (React Native).

## Features

- Vault management (credentials, cards, secure notes)
- Biometric unlock (FaceID / Fingerprint) via `expo-local-authentication`
- Local encrypted storage via `expo-sqlite` and `expo-secure-store`
- File-based routing via Expo Router
- Password generator with configurable options
- Light mode (peach/lime) and dark mode (green/black) themes
- Search and filter vault items

## App Structure

```
apps/mobile/
  app/                    # Expo Router file-based routes
    _layout.tsx           # Root layout with VaultProvider
    index.tsx             # Loading screen (routes to setup/unlock/vault)
    setup.tsx             # First-time vault creation
    recovery.tsx          # Recovery key display
    unlock.tsx            # Master password + biometric unlock
    (tabs)/               # Main tab navigation
      _layout.tsx         # Tab bar configuration
      index.tsx           # Vault item list with search/filter
      generator.tsx       # Password generator
      settings.tsx        # App settings
    item/
      add.tsx             # Add new credential/card/note
      [id].tsx            # Item detail view
      edit.tsx            # Edit existing item
  components/             # Reusable UI components
    Button.tsx
    TextInput.tsx
    ItemCard.tsx
    EmptyState.tsx
  lib/                    # Core logic
    theme.ts              # Light/dark theme system
    storage.ts            # SecureStore + SQLite persistence
    vault-context.tsx     # React context wrapping @keykeykey/core
  assets/
    icon.png              # App icon (1024×1024)
```

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- **Xcode** (for iOS) — install from the Mac App Store
- **CocoaPods** — `sudo gem install cocoapods` (or `brew install cocoapods`)
- **Android Studio** (for Android) — install from https://developer.android.com/studio

---

## Running on Your iOS Device

### Step 1: Build the shared packages

From the **monorepo root** (`/keykeykey`):

```bash
pnpm install
pnpm build
```

### Step 2: Generate the native iOS project

From the mobile app directory:

```bash
cd apps/mobile
npx expo prebuild --platform ios
```

This creates an `ios/` folder with a full Xcode project.

### Step 3: Install CocoaPods dependencies

```bash
cd ios
pod install
cd ..
```

This generates the `KeyKeyKey.xcworkspace` file needed by Xcode. Always use the `.xcworkspace` (not `.xcodeproj`) to open the project after this step.

> **Troubleshooting**: If `pod install` fails, try `pod install --repo-update` to refresh the CocoaPods spec repo.

### Step 4: Connect your iPhone

1. Connect your iPhone to your Mac via USB cable.
2. On your iPhone, tap **Trust** when prompted to trust this computer.
3. Make sure your iPhone is unlocked.

### Step 5: Set up code signing in Xcode

1. Open the Xcode workspace:
   ```bash
   open ios/KeyKeyKey.xcworkspace
   ```
2. In Xcode, click on the **KeyKeyKey** project in the left sidebar.
3. Select the **KeyKeyKey** target.
4. Go to the **Signing & Capabilities** tab.
5. Check **Automatically manage signing**.
6. Under **Team**, select your Apple ID (if you don't see one, click **Add an Account** and sign in with your Apple ID — a free account works fine).
7. Xcode will create a provisioning profile automatically. If the Bundle Identifier is already taken, change it to something unique like `com.keykeykey.app.yourname`.

### Step 6: Run on your device

Select your connected iPhone from the device dropdown at the top of Xcode, then click the **Play** button (or press `Cmd+R`).

Alternatively, from the terminal:

```bash
npx expo run:ios --device
```

### Step 7: Trust the developer on your iPhone

The first time you run a side-loaded app, iOS will block it:

1. On your iPhone, go to **Settings > General > VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID.
3. Tap **Trust** and confirm.
4. Now relaunch the app from your home screen.

### Troubleshooting iOS

- **"Unable to install app"**: Make sure your device is listed in your provisioning profile. Go to Xcode > Window > Devices and Simulators to verify.
- **`pod install` fails**: Run `cd ios && pod install --repo-update && cd ..`
- **"Cannot read properties of undefined (reading 'extract')"** during `npx expo prebuild`: Check that the root `package.json` does not override `tar` to v7+. Expo CLI requires `tar@^6`. Remove any `"tar": ">=7..."` from `pnpm.overrides`.
- **App crashes on launch**: Check the Xcode console output for errors. Ensure all Expo plugins are properly prebuilt.

---

## Running on Your Android Device

### Step 1: Build the shared packages

(Same as iOS Step 1 — skip if already done)

```bash
pnpm install
pnpm build
```

### Step 2: Enable Developer Mode on your Android device

1. Go to **Settings > About phone**.
2. Tap **Build number** 7 times until you see "You are now a developer."
3. Go back to **Settings > System > Developer options** (location varies by device).
4. Enable **USB debugging**.

### Step 3: Connect your device

1. Connect your Android device via USB cable.
2. When prompted on your phone, tap **Allow** for USB debugging.
3. Verify the connection:

   ```bash
   adb devices
   ```

   You should see your device listed (e.g., `XXXXXXX  device`).

   If `adb` is not found, add it to your PATH:

   ```bash
   export ANDROID_HOME=$HOME/Library/Android/sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools
   ```

   Add these lines to your `~/.zshrc` to make them permanent.

### Step 4: Generate the native Android project

```bash
cd apps/mobile
npx expo prebuild --platform android
```

This creates an `android/` folder with a Gradle project.

### Step 5: Run on your device

```bash
npx expo run:android --device
```

Or open the project in Android Studio:

```bash
open -a "Android Studio" android/
```

Then click the green **Run** button with your device selected.

### Troubleshooting Android

- **"No devices found"**: Run `adb devices` to check. Try unplugging/replugging USB. Make sure USB debugging is enabled.
- **Build fails on SDK version**: Open Android Studio > SDK Manager and install the required Android SDK (API level 34+ recommended).
- **Gradle build fails**: Try `cd android && ./gradlew clean && cd ..` then rebuild.

---

## iOS Credential Provider Extension (AutoFill)

KeyKeyKey includes an iOS AutoFill Credential Provider extension that lets users fill passwords directly from the iOS keyboard autofill prompt. The extension requires additional one-time Xcode setup after `expo prebuild`.

### Prerequisites

- Xcode 15+ with iOS 17+ SDK
- An Apple Developer account (free or paid)
- The main app must already build successfully (follow the iOS steps above first)

### Step 1: Prebuild the iOS project

```bash
cd apps/mobile
npx expo prebuild --clean --platform ios
cd ios && pod install && cd ..
```

This creates the `CredentialProvider` extension target via `@bacons/apple-targets`.

### Step 2: Add the swift-sodium SPM package in Xcode

The credential provider extension uses [libsodium](https://libsodium.org/) for cryptographic operations (XChaCha20-Poly1305 decryption and Argon2id key derivation). This dependency must be added manually in Xcode because `@bacons/apple-targets` does not automate SPM packages.

1. Open the Xcode workspace:

   ```bash
   open ios/KeyKeyKey.xcworkspace
   ```

2. In Xcode, go to **File > Add Package Dependencies...**

3. In the search field, paste:

   ```
   https://github.com/jedisct1/swift-sodium.git
   ```

4. Set the dependency rule to **Up to Next Major Version** with minimum version `0.9.1`.

5. Click **Add Package**.

6. When prompted to choose which target to add the package to, select **CredentialProvider** (NOT the main KeyKeyKey target). Click **Add Package**.

7. Verify the package was linked to the correct target:
   - Click on the **KeyKeyKey** project in the left sidebar
   - Select the **CredentialProvider** target
   - Go to **General > Frameworks, Libraries, and Embedded Content**
   - You should see `Sodium` listed. If not, click **+** and add it from the package.

### Step 3: Configure code signing for the extension

The credential provider extension needs its own code signing configuration:

1. In Xcode, select the **CredentialProvider** target (in the project navigator, under the KeyKeyKey project).

2. Go to **Signing & Capabilities**.

3. Check **Automatically manage signing**.

4. Select the same **Team** as the main KeyKeyKey target.

5. The bundle identifier should be `com.keykeykey.app.credential-provider` (set automatically by the config plugin). If it conflicts, change it to something unique like `com.keykeykey.app.credential-provider.yourname`.

6. Verify the following capabilities are listed:
   - **App Groups** — `group.com.keykeykey.shared`
   - **AutoFill Credential Provider** (if not present, click **+ Capability** and add it)

### Step 4: Build and run

1. Select your iPhone (or simulator) from the device dropdown.
2. Select the **KeyKeyKey** scheme (not CredentialProvider — the extension is embedded in the main app).
3. Build and run (`Cmd+R`).

The extension is automatically bundled inside the main app.

### Step 5: Enable KeyKeyKey in iOS AutoFill settings

On your device (or simulator):

1. Go to **Settings > Passwords > Password Options** (iOS 18) or **Settings > Passwords > AutoFill Passwords** (iOS 17).
2. Toggle **AutoFill Passwords and Passkeys** on.
3. Under **Use Passwords and Passkeys From**, enable **KeyKeyKey**.

### Step 6: Test the credential provider

1. Open the KeyKeyKey app and create a vault with some test credentials.
2. Enable biometric or PIN unlock in Settings.
3. Open Safari and navigate to a website you have a credential for (e.g., `github.com`).
4. Tap the username field — the iOS keyboard should show a **KeyKeyKey** autofill suggestion.
5. Tap the suggestion — the extension will prompt for biometric/PIN authentication.
6. After authentication, matching credentials are displayed. Tap one to fill.

### Testing different unlock flows

| Flow                | How to test                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Biometric**       | Enable Face ID/Touch ID in main app settings. Extension prompts biometric first.                                                                                               |
| **PIN**             | Enable PIN in main app settings. Cancel biometric (or disable it) — extension falls back to PIN.                                                                               |
| **Master password** | Disable both biometric and PIN. Extension shows "Please open KeyKeyKey" message (by design — master password is not supported in the extension due to iOS memory constraints). |
| **Wrong PIN**       | Enter an incorrect PIN. Extension shows remaining attempts. After 5 failures, PIN is disabled.                                                                                 |
| **No match**        | Navigate to a site with no saved credentials. Extension shows "No matching credentials" with options to create new or search vault.                                            |

### Troubleshooting

- **Extension doesn't appear in AutoFill settings**: Make sure the app was built with the CredentialProvider target. Check that the `com.apple.developer.authentication-services.autofill-credential-provider` entitlement is present in the extension target's Signing & Capabilities.
- **"KeychainAccessGroup not configured" crash**: The extension's Info.plist must contain a `KeychainAccessGroup` key. This is set automatically by the config plugin. If missing, verify `./plugins/credential-provider` is in your `app.json` plugins array and re-run `expo prebuild`.
- **"Decryption failed" errors**: The Swift crypto (libsodium) must match the TypeScript crypto format exactly. Run the cross-platform test vectors to verify: `pnpm --filter @keykeykey/core test -- --run src/crypto/__tests__/test-vectors.test.ts`
- **swift-sodium build errors**: Ensure you added the package to the **CredentialProvider** target, not the main app. The main app uses `@noble/ciphers` via JavaScript and does not need libsodium.
- **Extension crashes on launch**: Check the Xcode console. Common causes: App Group container not accessible (entitlement mismatch), SQLite database not found (main app not yet set up), Keychain access group mismatch.

### Running the Swift XCTests

The cross-platform compatibility tests verify that libsodium produces the same output as `@noble/ciphers`:

```bash
cd apps/mobile/ios
xcodebuild test \
  -workspace KeyKeyKey.xcworkspace \
  -scheme CredentialProvider \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  2>&1 | tail -30
```

These tests use the same test vectors as the TypeScript side (`packages/core/src/crypto/__tests__/test-vectors.json`).

---

## Running on Simulators/Emulators (No Physical Device)

### iOS Simulator

```bash
cd apps/mobile
npx expo prebuild --platform ios
cd ios && pod install && cd ..
npx expo run:ios
```

This launches the iOS Simulator with the app automatically. No signing or device setup needed.

### Android Emulator

1. Open Android Studio > **Virtual Device Manager** (from the welcome screen or Tools menu).
2. Create a new virtual device (e.g., Pixel 7, API 34).
3. Start the emulator.
4. Run:
   ```bash
   cd apps/mobile
   npx expo prebuild --platform android
   npx expo run:android
   ```

---

## Development with Expo Go (Quick Iteration)

For faster development without building native projects, you can use **Expo Go** — but note that some native modules (SQLite, SecureStore, LocalAuthentication) require a development build for full functionality.

```bash
cd apps/mobile
npx expo start
```

Then:

- **iOS**: Scan the QR code with your iPhone Camera app (Expo Go must be installed from the App Store).
- **Android**: Scan the QR code from the Expo Go app (install from Google Play).

> **Note**: Expo Go has limitations with native modules. For the full app experience with SQLite, SecureStore, and biometric auth, use `npx expo run:ios` or `npx expo run:android` to create a development build.

---

## Testing

```bash
# Run unit tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

70 tests across 10 test files covering screens, components, navigation, and vault context.

- **Unit/Integration**: Jest + `@testing-library/react-native`
- **E2E (planned)**: Maestro for critical user flows (onboarding, vault CRUD, biometric unlock)
