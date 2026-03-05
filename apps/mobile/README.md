# @keykeykey/mobile

KeyKeyKey mobile app for iOS and Android, built with Expo (React Native).

## Features

- Vault management (credentials, cards, secure notes)
- Biometric unlock (FaceID / Fingerprint) via `expo-local-authentication`
- Local encrypted storage via `expo-sqlite` and `expo-secure-store`
- File-based routing via Expo Router

## Prerequisites

- Node.js >= 22
- pnpm >= 10
- Expo CLI (`npx expo`)
- Xcode (iOS) or Android Studio (Android)

## Development

```bash
# Start Expo dev server
pnpm dev

# Run on iOS Simulator
pnpm ios

# Run on Android Emulator
pnpm android

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

## Project Structure

```
apps/mobile/
  app/             # Expo Router file-based routes
    _layout.tsx    # Root layout
    index.tsx      # Home screen
  components/      # Reusable React Native components
  assets/          # Images, fonts, icons
```

## Testing

- **Unit/Integration**: Jest + `@testing-library/react-native`
- **E2E**: Maestro for critical user flows (onboarding, vault CRUD, biometric unlock)
