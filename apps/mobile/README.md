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
```

## Prerequisites

Before running the app on your devices, ensure you have the following installed:

- **Node.js** >= 22
- **pnpm** >= 10
- **Xcode** (for iOS) — install from the Mac App Store
- **Android Studio** (for Android) — install from https://developer.android.com/studio

---

## Running on Your iOS Device

### Step 1: Build the shared packages

From the **monorepo root** (`/keykeykey`):

```bash
pnpm install
pnpm --filter @keykeykey/core build
pnpm --filter @keykeykey/ui build
```

### Step 2: Generate the native iOS project

From the mobile app directory:

```bash
cd apps/mobile
npx expo prebuild --platform ios
```

This creates an `ios/` folder with a full Xcode project.

### Step 3: Connect your iPhone

1. Connect your iPhone to your Mac via USB cable.
2. On your iPhone, tap **Trust** when prompted to trust this computer.
3. Make sure your iPhone is unlocked.

### Step 4: Set up code signing in Xcode

1. Open the Xcode project:
   ```bash
   open ios/keykeykey.xcworkspace
   ```
2. In Xcode, click on the **keykeykey** project in the left sidebar.
3. Select the **keykeykey** target.
4. Go to the **Signing & Capabilities** tab.
5. Check **Automatically manage signing**.
6. Under **Team**, select your Apple ID (if you don't see one, click **Add an Account** and sign in with your Apple ID — a free account works fine).
7. Xcode will create a provisioning profile automatically. If the Bundle Identifier is already taken, change it to something unique like `com.keykeykey.app.yourname`.

### Step 5: Run on your device

Select your connected iPhone from the device dropdown at the top of Xcode, then click the **Play** button (or press `Cmd+R`).

Alternatively, from the terminal:
```bash
npx expo run:ios --device
```

### Step 6: Trust the developer on your iPhone

The first time you run a side-loaded app, iOS will block it:

1. On your iPhone, go to **Settings > General > VPN & Device Management**.
2. Under **Developer App**, tap your Apple ID.
3. Tap **Trust** and confirm.
4. Now relaunch the app from your home screen.

### Troubleshooting iOS

- **"Unable to install app"**: Make sure your device is listed in your provisioning profile. Go to Xcode > Window > Devices and Simulators to verify.
- **Build fails on pod install**: Run `cd ios && pod install --repo-update && cd ..`
- **App crashes on launch**: Check the Xcode console output for errors. Ensure all Expo plugins are properly prebuild.

---

## Running on Your Android Device

### Step 1: Build the shared packages

(Same as iOS Step 1 — skip if already done)

```bash
pnpm install
pnpm --filter @keykeykey/core build
pnpm --filter @keykeykey/ui build
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

## Running on Simulators/Emulators (No Physical Device)

### iOS Simulator

```bash
cd apps/mobile
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

- **Unit/Integration**: Jest + `@testing-library/react-native`
- **E2E**: Maestro for critical user flows (onboarding, vault CRUD, biometric unlock)
