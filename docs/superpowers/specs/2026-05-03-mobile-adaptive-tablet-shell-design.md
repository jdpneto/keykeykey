# Mobile Adaptive Tablet Shell Design

**Owner:** `apps/mobile`

**Goal:** Add native tablet-friendly navigation to the existing Expo iOS and
Android app without creating separate tablet apps or changing the phone
experience.

## Context

The mobile app already ships as one Expo app for iOS and Android. iOS has
`supportsTablet: true` in `apps/mobile/app.json`, but the app is currently
locked to portrait and the unlocked app area uses bottom tabs everywhere.

The desktop app already uses a left navigation rail in
`apps/desktop/src/components/AppShell.tsx`. The mobile tablet design should
borrow that information architecture while staying native to React Native and
Expo Router.

This design covers both iPadOS and Android large screens. Android tablets,
foldables, Chromebooks running Android apps, split-screen windows, and large
phones in landscape are included by using available layout width instead of
platform or device-family checks.

## Decisions

1. Keep one Expo mobile app binary for phones and tablets.
2. Use an adaptive unlocked shell with a `600dp` width breakpoint.
3. Keep current bottom tabs below `600dp`.
4. Switch to a Version A style left sidebar at `>= 600dp`.
5. Add a persistent orientation preference under Settings -> Appearance.
6. Support iOS and Android through the same React Native code paths where
   possible.

## Non-Goals

- No separate iPadOS app target.
- No separate Android tablet app target.
- No master-detail Vault layout in this pass.
- No broad screen-level redesigns for Vault, Authenticator, Generator, or
  Settings beyond fitting inside the adaptive shell.
- No desktop code sharing with Tauri components; the desktop app remains React
  DOM and the mobile app remains React Native.

## Adaptive Shell

The adaptive shell lives at the existing unlocked route group,
`apps/mobile/app/(tabs)/_layout.tsx`.

Use `useWindowDimensions()` to classify the current available width:

```ts
const isWide = width >= 600;
```

The `600dp` threshold is based on available React Native layout width, not
physical pixels. This makes the behavior work for:

- iPad portrait and landscape.
- Android tablets in portrait and landscape.
- Android foldables.
- Android split-screen and resizable windows.
- Large phones in landscape if the available width is large enough.

### Narrow Layout

For widths below `600dp`, preserve the current Expo Router `Tabs` behavior:

- Vault
- Authenticator
- Generator
- Settings

The current tab labels, icons, test IDs, and accessibility labels should stay
stable where practical so mobile E2E flows do not need broad updates.

### Wide Layout

For widths at or above `600dp`, render a React Native sidebar and a content
region:

- Sidebar width: fixed, desktop-like, roughly `220dp`.
- Sidebar content: KeyKeyKey brand, four navigation items, and Lock Vault.
- Active item: text weight and a primary-color indicator matching the desktop
  shell's selected state.
- Content region: fills remaining width, uses the existing screen content.
- Quick unlock prompt: still appears once after unlock, independent of shell
  layout.

Sidebar navigation targets:

| Item          | Route                   |
| ------------- | ----------------------- |
| Vault         | `/(tabs)`               |
| Authenticator | `/(tabs)/authenticator` |
| Generator     | `/(tabs)/generator`     |
| Settings      | `/(tabs)/settings`      |

Lock Vault calls `lock()` from the mobile vault context and routes to
`/unlock`, matching the current desktop shell behavior.

## Component Boundaries

### `useIsWideLayout`

Create a small hook under `apps/mobile/lib/`:

- Uses `useWindowDimensions()`.
- Returns `true` when width is `>= 600`.
- Keeps the breakpoint in one place for tests and future tuning.

### `TabletSidebarShell`

Create a React Native component under `apps/mobile/components/`:

- Owns the left navigation rail.
- Accepts an active route key: `vault`, `authenticator`, `generator`, or
  `settings`.
- Uses Expo Router navigation.
- Calls vault `lock()` for Lock Vault.
- Uses `Ionicons` to match the existing mobile icon system.
- Uses mobile theme tokens from `useTheme()`.
- Avoids iOS-only APIs so Android tablets use the same component.

### `AdaptiveTabsLayout`

Refactor `apps/mobile/app/(tabs)/_layout.tsx` so it:

- Keeps the current bottom tab layout for narrow widths.
- Renders `TabletSidebarShell` and the selected tab content for wide widths.
- Keeps the quick unlock prompt logic intact.
- Does not move root status guard behavior out of `apps/mobile/app/_layout.tsx`.

## Orientation Preference

Add a persistent orientation setting under Settings -> Appearance.

Options:

| Option       | Behavior                                                      |
| ------------ | ------------------------------------------------------------- |
| System       | Follow platform/window default behavior. This is default.     |
| Portrait     | Lock to portrait orientation.                                 |
| Landscape    | Lock to landscape orientation.                                |
| Lock current | Read current orientation and lock to that orientation family. |

The current static `"orientation": "portrait"` in `apps/mobile/app.json` must be
loosened or removed so runtime preferences can work. Runtime application should
use `expo-screen-orientation`, added to the mobile app if it is not already
available.

### Persistence

Store the preference as a non-secret mobile setting. It is not sync state and
does not belong in `PlatformStorage`.

Use these persisted values:

```ts
type OrientationPreference = 'system' | 'portrait' | 'landscape' | 'current';
```

The setting can live in the same mobile storage module style as other non-secret
settings such as quick unlock prompt state.

### Runtime Behavior

Mount an `OrientationPreferenceController` near the mobile root layout:

- Reads the saved preference on startup.
- Applies the selected lock through `expo-screen-orientation`.
- Re-applies when the user changes the setting.
- For `system`, unlocks back to the platform default.
- For `current`, reads the current orientation and locks to portrait or
  landscape based on the current family.
- If the OS refuses or does not support a requested lock, show a non-blocking
  alert and keep the app usable.

The adaptive sidebar remains based on available width even when orientation is
locked. Orientation preference should not be used as the sidebar breakpoint.

## Testing

Add focused Jest coverage in `apps/mobile/__tests__/`:

1. `useIsWideLayout` returns narrow at `599dp` and wide at `600dp`.
2. Adaptive tabs layout renders bottom tabs below `600dp`.
3. Adaptive tabs layout renders sidebar at `600dp` and above.
4. Sidebar presses navigate to all four tab routes.
5. Sidebar Lock Vault calls `lock()` and routes to `/unlock`.
6. Orientation preference storage saves and loads every option.
7. Orientation controller applies `system`, `portrait`, `landscape`, and
   `lock current` against iOS and Android mocks.
8. Settings exposes the orientation row under Appearance and persists the
   selected option.

Manual verification after implementation:

- iPhone or narrow Android phone keeps bottom tabs.
- iPad portrait shows the sidebar.
- Android tablet portrait shows the sidebar.
- Android tablet landscape and split-screen switch by available width.
- Large phone landscape shows the sidebar only when available width is at least
  `600dp`.
- Orientation preferences work on iOS and Android or fail gracefully with a
  non-blocking message.

## Follow-Up Candidates

- Vault master-detail layout for `>= 600dp`.
- Denser tablet-specific Settings sections.
- Generator layout tuned for tablet width.
- Android foldable posture-specific refinements if user testing shows a need.
