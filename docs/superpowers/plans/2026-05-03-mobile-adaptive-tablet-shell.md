# Mobile Adaptive Tablet Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 600dp adaptive sidebar shell and orientation preference to the existing Expo iOS and Android app.

**Architecture:** Keep one Expo Router mobile app. Below 600dp, the existing bottom tabs stay in place; at 600dp and above, the same tab navigator moves to a left-positioned custom tab bar that looks like the desktop sidebar and includes Lock Vault. Orientation is a non-secret AsyncStorage setting applied by a root-mounted controller using `expo-screen-orientation`.

**Tech Stack:** Expo Router 4, React Native 0.76, Jest + `@testing-library/react-native`, `@expo/vector-icons`, `@react-native-async-storage/async-storage`, `expo-screen-orientation` SDK 52 bundled version `~8.0.4`.

---

## File Structure

- Create `apps/mobile/lib/use-is-wide-layout.ts`: one hook and exported breakpoint constant.
- Create `apps/mobile/__tests__/lib/use-is-wide-layout.test.tsx`: red/green coverage for 599dp and 600dp.
- Create `apps/mobile/components/TabletSidebarShell.tsx`: custom React Navigation tab bar for wide layouts.
- Create `apps/mobile/__tests__/components/TabletSidebarShell.test.tsx`: navigation and lock behavior.
- Modify `apps/mobile/app/(tabs)/_layout.tsx`: choose bottom tabs or left sidebar based on `useIsWideLayout()`.
- Create `apps/mobile/__tests__/screens/adaptive-tabs-layout.test.tsx`: asserts narrow and wide tab layout selection.
- Create `apps/mobile/lib/orientation-preference.tsx`: AsyncStorage persistence, provider/hook, controller, and screen-orientation adapter.
- Create `apps/mobile/__tests__/lib/orientation-preference.test.tsx`: storage and controller behavior.
- Modify `apps/mobile/app/_layout.tsx`: mount orientation provider/controller near the app root.
- Create `apps/mobile/__tests__/screens/root-layout.test.tsx`: asserts root orientation wiring.
- Modify `apps/mobile/app/(tabs)/settings.tsx`: add Settings -> Appearance -> Orientation row.
- Modify `apps/mobile/__tests__/screens/settings.test.tsx`: assert row rendering and persistence.
- Modify `apps/mobile/app.json`: remove static `"orientation": "portrait"`.
- Modify `apps/mobile/package.json` and `pnpm-lock.yaml`: add `expo-screen-orientation`.

Do not set `ios.requireFullScreen: true`; that would trade away iPad Split View/resizable-window support. If iPadOS refuses a runtime lock in a split view, the controller will show a non-blocking alert.

---

### Task 1: Wide Layout Breakpoint Hook

**Files:**

- Create: `apps/mobile/lib/use-is-wide-layout.ts`
- Create: `apps/mobile/__tests__/lib/use-is-wide-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/lib/use-is-wide-layout.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { WIDE_LAYOUT_MIN_WIDTH, useIsWideLayout } from '../../lib/use-is-wide-layout';

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    useWindowDimensions: jest.fn(),
  };
});

const mockedUseWindowDimensions = useWindowDimensions as jest.MockedFunction<
  typeof useWindowDimensions
>;

describe('useIsWideLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exports the 600dp breakpoint', () => {
    expect(WIDE_LAYOUT_MIN_WIDTH).toBe(600);
  });

  it('returns false below 600dp', () => {
    mockedUseWindowDimensions.mockReturnValue({
      width: 599,
      height: 900,
      scale: 2,
      fontScale: 1,
    });

    const { result } = renderHook(() => useIsWideLayout());

    expect(result.current).toBe(false);
  });

  it('returns true at 600dp', () => {
    mockedUseWindowDimensions.mockReturnValue({
      width: 600,
      height: 900,
      scale: 2,
      fontScale: 1,
    });

    const { result } = renderHook(() => useIsWideLayout());

    expect(result.current).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/lib/use-is-wide-layout.test.tsx
```

Expected: FAIL because `../../lib/use-is-wide-layout` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/lib/use-is-wide-layout.ts`:

```ts
import { useWindowDimensions } from 'react-native';

export const WIDE_LAYOUT_MIN_WIDTH = 600;

export function useIsWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_LAYOUT_MIN_WIDTH;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/lib/use-is-wide-layout.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/use-is-wide-layout.ts apps/mobile/__tests__/lib/use-is-wide-layout.test.tsx
git commit -m "feat(mobile): add wide layout breakpoint hook"
```

---

### Task 2: Tablet Sidebar Tab Bar

**Files:**

- Create: `apps/mobile/components/TabletSidebarShell.tsx`
- Create: `apps/mobile/__tests__/components/TabletSidebarShell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/components/TabletSidebarShell.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TabletSidebarShell } from '../../components/TabletSidebarShell';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLock = jest.fn();
const mockVaultState = {
  lock: mockLock,
  isBusy: false,
};

jest.mock('../../lib/vault-context', () => ({
  useVault: () => mockVaultState,
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

function makeProps(overrides: Record<string, unknown> = {}) {
  const routes = [
    { key: 'index-key', name: 'index', params: undefined },
    { key: 'auth-key', name: 'authenticator', params: undefined },
    { key: 'generator-key', name: 'generator', params: undefined },
    { key: 'settings-key', name: 'settings', params: undefined },
  ];

  return {
    state: {
      stale: false,
      type: 'tab',
      key: 'tab-state',
      index: 0,
      routeNames: routes.map((route) => route.name),
      routes,
      history: [],
    },
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])),
    navigation: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides,
  } as any;
}

describe('TabletSidebarShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultState.isBusy = false;
  });

  it('renders brand, nav items, and lock action', () => {
    const { getByText, getByTestId } = render(<TabletSidebarShell {...makeProps()} />);

    expect(getByText('KeyKeyKey')).toBeTruthy();
    expect(getByText('Vault')).toBeTruthy();
    expect(getByText('Authenticator')).toBeTruthy();
    expect(getByText('Generator')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-lock')).toBeTruthy();
  });

  it('navigates to a tab route when a sidebar item is pressed', () => {
    const props = makeProps();
    const { getByTestId } = render(<TabletSidebarShell {...props} />);

    fireEvent.press(getByTestId('tablet-sidebar-authenticator'));

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'auth-key',
      canPreventDefault: true,
    });
    expect(props.navigation.navigate).toHaveBeenCalledWith('authenticator', undefined);
  });

  it('does not navigate when tabPress is prevented', () => {
    const props = makeProps({
      navigation: {
        emit: jest.fn(() => ({ defaultPrevented: true })),
        navigate: jest.fn(),
      },
    });
    const { getByTestId } = render(<TabletSidebarShell {...props} />);

    fireEvent.press(getByTestId('tablet-sidebar-generator'));

    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });

  it('locks the vault and routes to unlock', () => {
    const { getByTestId } = render(<TabletSidebarShell {...makeProps()} />);

    fireEvent.press(getByTestId('tablet-sidebar-lock'));

    expect(mockLock).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/unlock');
  });

  it('disables navigation and lock while the vault is busy', () => {
    mockVaultState.isBusy = true;
    const props = makeProps();
    const { getByTestId } = render(<TabletSidebarShell {...props} />);

    fireEvent.press(getByTestId('tablet-sidebar-settings'));
    fireEvent.press(getByTestId('tablet-sidebar-lock'));

    expect(props.navigation.navigate).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/components/TabletSidebarShell.test.tsx
```

Expected: FAIL because `../../components/TabletSidebarShell` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/mobile/components/TabletSidebarShell.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { useVault } from '@/lib/vault-context';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
type RouteName = 'index' | 'authenticator' | 'generator' | 'settings';

const NAV_ITEMS: Array<{
  routeName: RouteName;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
}> = [
  { routeName: 'index', label: 'Vault', icon: 'shield-outline', testID: 'tablet-sidebar-vault' },
  {
    routeName: 'authenticator',
    label: 'Authenticator',
    icon: 'shield-checkmark-outline',
    testID: 'tablet-sidebar-authenticator',
  },
  {
    routeName: 'generator',
    label: 'Generator',
    icon: 'dice-outline',
    testID: 'tablet-sidebar-generator',
  },
  {
    routeName: 'settings',
    label: 'Settings',
    icon: 'settings-outline',
    testID: 'tablet-sidebar-settings',
  },
];

export function TabletSidebarShell({ state, navigation }: TabBarProps) {
  const { theme: t } = useTheme();
  const { lock, isBusy } = useVault();
  const router = useRouter();
  const activeRouteName = state.routes[state.index]?.name;

  const navigateTo = (routeName: RouteName) => {
    if (isBusy) return;
    const route = state.routes.find((candidate) => candidate.name === routeName);
    if (!route) return;

    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });

    if (activeRouteName !== routeName && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  const handleLock = () => {
    if (isBusy) return;
    lock();
    router.replace('/unlock');
  };

  return (
    <View
      style={[
        styles.sidebar,
        {
          backgroundColor: t.colors.surface,
          borderRightColor: t.colors.border,
        },
      ]}
      testID="tablet-sidebar"
    >
      <Text style={[styles.brand, { color: t.colors.primary }]}>KeyKeyKey</Text>

      <View style={styles.navItems}>
        {NAV_ITEMS.map((item) => {
          const active = activeRouteName === item.routeName;
          return (
            <Pressable
              key={item.routeName}
              testID={item.testID}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: isBusy && !active }}
              onPress={() => navigateTo(item.routeName)}
              disabled={isBusy && !active}
              style={[
                styles.navItem,
                {
                  backgroundColor: active ? t.colors.surfaceAlt : 'transparent',
                  borderRightColor: active ? t.colors.primary : 'transparent',
                  opacity: isBusy && !active ? 0.4 : 1,
                },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={active ? t.colors.text : t.colors.textSecondary}
              />
              <Text
                style={[
                  styles.navLabel,
                  {
                    color: active ? t.colors.text : t.colors.textSecondary,
                    fontWeight: active ? '600' : '400',
                  },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        testID="tablet-sidebar-lock"
        accessibilityRole="button"
        accessibilityState={{ disabled: isBusy }}
        onPress={handleLock}
        disabled={isBusy}
        style={[styles.lockButton, { opacity: isBusy ? 0.4 : 1 }]}
      >
        <Ionicons name="lock-closed-outline" size={18} color={t.colors.textSecondary} />
        <Text style={[styles.lockLabel, { color: t.colors.textSecondary }]}>Lock Vault</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    minWidth: 220,
    flex: 1,
    borderRightWidth: 1,
    paddingTop: 24,
    paddingBottom: 24,
  },
  brand: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  navItems: {
    flex: 1,
    gap: 2,
  },
  navItem: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderRightWidth: 3,
  },
  navLabel: {
    fontSize: 14,
  },
  lockButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  lockLabel: {
    fontSize: 14,
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/components/TabletSidebarShell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/components/TabletSidebarShell.tsx apps/mobile/__tests__/components/TabletSidebarShell.test.tsx
git commit -m "feat(mobile): add tablet sidebar shell"
```

---

### Task 3: Adaptive Tabs Layout

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/__tests__/screens/adaptive-tabs-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/screens/adaptive-tabs-layout.test.tsx`:

```tsx
import React from 'react';
import { Text, View } from 'react-native';
import { render } from '@testing-library/react-native';
import TabLayout from '../../app/(tabs)/_layout';

const mockUseIsWideLayout = jest.fn();
jest.mock('../../lib/use-is-wide-layout', () => ({
  useIsWideLayout: () => mockUseIsWideLayout(),
}));

const mockTabletSidebarShell = jest.fn(() => <View testID="tablet-sidebar-shell" />);
jest.mock('../../components/TabletSidebarShell', () => ({
  TabletSidebarShell: (props: unknown) => mockTabletSidebarShell(props),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  function Tabs({ children, tabBar, screenOptions }: any) {
    return (
      <View
        testID={tabBar ? 'wide-tabs' : 'narrow-tabs'}
        accessibilityLabel={screenOptions.tabBarPosition === 'left' ? 'left-tabs' : 'bottom-tabs'}
      >
        {tabBar ? tabBar({ state: { index: 0, routes: [] } }) : null}
        {children}
      </View>
    );
  }

  Tabs.Screen = ({ name }: any) => <Text>{name}</Text>;

  return { Tabs };
});

jest.mock('../../lib/vault-context', () => ({
  useVault: () => ({
    status: 'unlocked',
    quickUnlockPromptShown: true,
  }),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('../../components/QuickUnlockPrompt', () => ({
  QuickUnlockPrompt: () => <View testID="quick-unlock-prompt" />,
}));

describe('adaptive tab layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the existing bottom tab navigator on narrow widths', () => {
    mockUseIsWideLayout.mockReturnValue(false);

    const { getByTestId, queryByTestId } = render(<TabLayout />);

    expect(getByTestId('narrow-tabs').props.accessibilityLabel).toBe('bottom-tabs');
    expect(queryByTestId('tablet-sidebar-shell')).toBeNull();
  });

  it('renders the tablet sidebar tab bar on wide widths', () => {
    mockUseIsWideLayout.mockReturnValue(true);

    const { getByTestId } = render(<TabLayout />);

    expect(getByTestId('wide-tabs').props.accessibilityLabel).toBe('left-tabs');
    expect(getByTestId('tablet-sidebar-shell')).toBeTruthy();
    expect(mockTabletSidebarShell).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/adaptive-tabs-layout.test.tsx
```

Expected: FAIL because `_layout.tsx` does not use `useIsWideLayout` or `TabletSidebarShell`.

- [ ] **Step 3: Write minimal implementation**

Modify `apps/mobile/app/(tabs)/_layout.tsx`:

```tsx
import { useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { useVault } from '@/lib/vault-context';
import { QuickUnlockPrompt } from '@/components/QuickUnlockPrompt';
import { TabletSidebarShell } from '@/components/TabletSidebarShell';
import { useIsWideLayout } from '@/lib/use-is-wide-layout';

export default function TabLayout() {
  const { theme: t } = useTheme();
  const { status, quickUnlockPromptShown } = useVault();
  const isWide = useIsWideLayout();
  const [promptDismissed, setPromptDismissed] = useState(false);

  const showQuickUnlockPrompt =
    status === 'unlocked' && !quickUnlockPromptShown && !promptDismissed;

  return (
    <>
      <Tabs
        tabBar={isWide ? (props) => <TabletSidebarShell {...props} /> : undefined}
        screenOptions={{
          headerShown: false,
          tabBarPosition: isWide ? 'left' : 'bottom',
          tabBarVariant: isWide ? 'material' : 'uikit',
          tabBarLabelPosition: isWide ? 'beside-icon' : 'below-icon',
          tabBarActiveTintColor: t.colors.primary,
          tabBarInactiveTintColor: t.colors.textSecondary,
          sceneStyle: {
            backgroundColor: t.colors.background,
          },
          tabBarStyle: {
            backgroundColor: t.colors.background,
            borderTopColor: t.colors.border,
            borderTopWidth: isWide ? 0 : 1,
            borderRightColor: t.colors.border,
            borderRightWidth: isWide ? 1 : 0,
          },
          tabBarLabelStyle: {
            fontSize: isWide ? 14 : 11,
            fontWeight: '500',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Vault',
            tabBarButtonTestID: 'tab-vault',
            tabBarAccessibilityLabel: 'Vault',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shield-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="authenticator"
          options={{
            title: 'Authenticator',
            tabBarButtonTestID: 'tab-authenticator',
            tabBarAccessibilityLabel: 'Authenticator',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="shield-checkmark-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="generator"
          options={{
            title: 'Generator',
            tabBarButtonTestID: 'tab-generator',
            tabBarAccessibilityLabel: 'Generator',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="dice-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarButtonTestID: 'tab-settings',
            tabBarAccessibilityLabel: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>

      {showQuickUnlockPrompt && <QuickUnlockPrompt onDismiss={() => setPromptDismissed(true)} />}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/adaptive-tabs-layout.test.tsx __tests__/components/TabletSidebarShell.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/_layout.tsx apps/mobile/__tests__/screens/adaptive-tabs-layout.test.tsx
git commit -m "feat(mobile): adapt tabs for tablet widths"
```

---

### Task 4: Orientation Preference Storage And Controller

**Files:**

- Create: `apps/mobile/lib/orientation-preference.tsx`
- Create: `apps/mobile/__tests__/lib/orientation-preference.test.tsx`
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Add the Expo dependency**

Run:

```bash
pnpm --filter @keykeykey/mobile add expo-screen-orientation@~8.0.4
```

Expected: `apps/mobile/package.json` gains `expo-screen-orientation` and `pnpm-lock.yaml` updates. This is the bundled version documented for Expo SDK 52.

- [ ] **Step 2: Write the failing test**

Create `apps/mobile/__tests__/lib/orientation-preference.test.tsx`:

```tsx
import React from 'react';
import { Alert } from 'react-native';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  ORIENTATION_LABELS,
  OrientationPreferenceController,
  OrientationPreferenceProvider,
  applyOrientationPreference,
  loadOrientationPreference,
  saveOrientationPreference,
  useOrientationPreference,
} from '../../lib/orientation-preference';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-screen-orientation', () => ({
  Orientation: {
    UNKNOWN: 0,
    PORTRAIT_UP: 1,
    PORTRAIT_DOWN: 2,
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  },
  OrientationLock: {
    DEFAULT: 0,
    PORTRAIT: 2,
    LANDSCAPE: 5,
  },
  getOrientationAsync: jest.fn(),
  lockAsync: jest.fn(),
  supportsOrientationLockAsync: jest.fn(),
  unlockAsync: jest.fn(),
}));

const mockedAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockedScreenOrientation = ScreenOrientation as jest.Mocked<typeof ScreenOrientation>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <OrientationPreferenceProvider>{children}</OrientationPreferenceProvider>
);

describe('orientation preference', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAsyncStorage.getItem.mockResolvedValue(null);
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValue(true);
    mockedScreenOrientation.lockAsync.mockResolvedValue(undefined);
    mockedScreenOrientation.unlockAsync.mockResolvedValue(undefined);
    mockedScreenOrientation.getOrientationAsync.mockResolvedValue(
      ScreenOrientation.Orientation.PORTRAIT_UP,
    );
  });

  it('defaults to system when storage is empty or invalid', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce(null);
    await expect(loadOrientationPreference()).resolves.toBe('system');

    mockedAsyncStorage.getItem.mockResolvedValueOnce('sideways');
    await expect(loadOrientationPreference()).resolves.toBe('system');
  });

  it('saves a valid preference', async () => {
    await saveOrientationPreference('landscape');

    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'keykeykey-orientation-preference',
      'landscape',
    );
  });

  it('applies system by unlocking orientation', async () => {
    await applyOrientationPreference('system');

    expect(mockedScreenOrientation.unlockAsync).toHaveBeenCalled();
    expect(mockedScreenOrientation.lockAsync).not.toHaveBeenCalled();
  });

  it('applies portrait and landscape locks', async () => {
    await applyOrientationPreference('portrait');
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.PORTRAIT,
    );

    await applyOrientationPreference('landscape');
    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  });

  it('locks current to the current orientation family', async () => {
    mockedScreenOrientation.getOrientationAsync.mockResolvedValueOnce(
      ScreenOrientation.Orientation.LANDSCAPE_LEFT,
    );

    await applyOrientationPreference('current');

    expect(mockedScreenOrientation.lockAsync).toHaveBeenCalledWith(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    );
  });

  it('throws when the requested lock is unsupported', async () => {
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValueOnce(false);

    await expect(applyOrientationPreference('portrait')).rejects.toThrow(
      'Orientation lock portrait is not supported on this device.',
    );
  });

  it('exposes provider state and persists updates', async () => {
    mockedAsyncStorage.getItem.mockResolvedValueOnce('portrait');

    const { result } = renderHook(() => useOrientationPreference(), { wrapper });

    await waitFor(() => {
      expect(result.current.preference).toBe('portrait');
    });

    await act(async () => {
      await result.current.setPreference('landscape');
    });

    expect(result.current.preference).toBe('landscape');
    expect(mockedAsyncStorage.setItem).toHaveBeenCalledWith(
      'keykeykey-orientation-preference',
      'landscape',
    );
  });

  it('shows a non-blocking alert when controller cannot apply a lock', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockedAsyncStorage.getItem.mockResolvedValueOnce('portrait');
    mockedScreenOrientation.supportsOrientationLockAsync.mockResolvedValueOnce(false);

    render(
      <OrientationPreferenceProvider>
        <OrientationPreferenceController />
      </OrientationPreferenceProvider>,
    );

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Orientation unavailable',
        'This device or window does not support the selected orientation lock.',
      );
    });
  });

  it('provides labels for settings display', () => {
    expect(ORIENTATION_LABELS.system).toBe('System');
    expect(ORIENTATION_LABELS.portrait).toBe('Portrait');
    expect(ORIENTATION_LABELS.landscape).toBe('Landscape');
    expect(ORIENTATION_LABELS.current).toBe('Lock current');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/lib/orientation-preference.test.tsx
```

Expected: FAIL because `../../lib/orientation-preference` does not exist.

- [ ] **Step 4: Write minimal implementation**

Create `apps/mobile/lib/orientation-preference.tsx`:

```tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenOrientation from 'expo-screen-orientation';

export type OrientationPreference = 'system' | 'portrait' | 'landscape' | 'current';

type OrientationPreferenceContextType = {
  preference: OrientationPreference;
  setPreference: (preference: OrientationPreference) => Promise<void>;
};

const STORAGE_KEY = 'keykeykey-orientation-preference';

export const ORIENTATION_LABELS: Record<OrientationPreference, string> = {
  system: 'System',
  portrait: 'Portrait',
  landscape: 'Landscape',
  current: 'Lock current',
};

const OrientationPreferenceContext = createContext<OrientationPreferenceContextType | null>(null);

function isOrientationPreference(value: string | null): value is OrientationPreference {
  return value === 'system' || value === 'portrait' || value === 'landscape' || value === 'current';
}

export async function loadOrientationPreference(): Promise<OrientationPreference> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  return isOrientationPreference(saved) ? saved : 'system';
}

export async function saveOrientationPreference(preference: OrientationPreference): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, preference);
}

function orientationFamilyToLock(
  orientation: ScreenOrientation.Orientation,
): ScreenOrientation.OrientationLock {
  if (
    orientation === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
    orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT
  ) {
    return ScreenOrientation.OrientationLock.LANDSCAPE;
  }
  return ScreenOrientation.OrientationLock.PORTRAIT;
}

async function assertLockSupported(
  lock: ScreenOrientation.OrientationLock,
  label: OrientationPreference,
): Promise<void> {
  const supported = await ScreenOrientation.supportsOrientationLockAsync(lock);
  if (!supported) {
    throw new Error(`Orientation lock ${label} is not supported on this device.`);
  }
}

export async function applyOrientationPreference(preference: OrientationPreference): Promise<void> {
  if (preference === 'system') {
    await ScreenOrientation.unlockAsync();
    return;
  }

  let lock: ScreenOrientation.OrientationLock;
  if (preference === 'portrait') {
    lock = ScreenOrientation.OrientationLock.PORTRAIT;
  } else if (preference === 'landscape') {
    lock = ScreenOrientation.OrientationLock.LANDSCAPE;
  } else {
    const orientation = await ScreenOrientation.getOrientationAsync();
    lock = orientationFamilyToLock(orientation);
  }

  await assertLockSupported(lock, preference);
  await ScreenOrientation.lockAsync(lock);
}

export function OrientationPreferenceProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<OrientationPreference>('system');

  useEffect(() => {
    let mounted = true;
    loadOrientationPreference()
      .then((saved) => {
        if (mounted) setPreferenceState(saved);
      })
      .catch(() => {
        if (mounted) setPreferenceState('system');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback(async (next: OrientationPreference) => {
    setPreferenceState(next);
    await saveOrientationPreference(next);
  }, []);

  return (
    <OrientationPreferenceContext.Provider value={{ preference, setPreference }}>
      {children}
    </OrientationPreferenceContext.Provider>
  );
}

export function OrientationPreferenceController() {
  const { preference } = useOrientationPreference();

  useEffect(() => {
    let mounted = true;
    applyOrientationPreference(preference).catch(() => {
      if (!mounted) return;
      Alert.alert(
        'Orientation unavailable',
        'This device or window does not support the selected orientation lock.',
      );
    });
    return () => {
      mounted = false;
    };
  }, [preference]);

  return null;
}

export function useOrientationPreference(): OrientationPreferenceContextType {
  const context = useContext(OrientationPreferenceContext);
  if (!context) {
    throw new Error('useOrientationPreference must be used within OrientationPreferenceProvider');
  }
  return context;
}
```

- [ ] **Step 5: Remove static portrait lock from app config**

Modify `apps/mobile/app.json` by removing this line:

```json
"orientation": "portrait",
```

Do not add `ios.requireFullScreen`.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/lib/orientation-preference.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/lib/orientation-preference.tsx apps/mobile/__tests__/lib/orientation-preference.test.tsx apps/mobile/package.json pnpm-lock.yaml apps/mobile/app.json
git commit -m "feat(mobile): add orientation preference controller"
```

---

### Task 5: Mount Orientation Controller At Root

**Files:**

- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/__tests__/screens/root-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/screens/root-layout.test.tsx`:

```tsx
import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import RootLayout from '../../app/_layout';

const mockReplace = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  function Stack({ children }: any) {
    return <View testID="root-stack">{children}</View>;
  }

  Stack.Screen = ({ name }: any) => <View testID={`stack-screen-${name}`} />;

  return {
    Stack,
    useRouter: () => ({ replace: mockReplace }),
  };
});

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('@keykeykey/core', () => ({
  setArgon2Adapter: jest.fn(),
}));

jest.mock('../../lib/native-argon2-adapter', () => ({
  nativeArgon2Adapter: {},
}));

jest.mock('../../lib/vault-context', () => ({
  VaultProvider: ({ children }: any) => children,
  useVault: () => ({
    onActivity: jest.fn(),
    status: 'unlocked',
  }),
}));

import { mockThemeValue } from '../helpers/mock-theme';

jest.mock('../../lib/theme-provider', () => ({
  ThemeProvider: ({ children }: any) => children,
  useTheme: () => ({
    theme: mockThemeValue.theme,
    isDark: false,
  }),
}));

jest.mock('../../lib/orientation-preference', () => ({
  OrientationPreferenceProvider: ({ children }: any) => (
    <View testID="orientation-provider">{children}</View>
  ),
  OrientationPreferenceController: () => <View testID="orientation-controller" />,
}));

describe('RootLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('mounts the orientation preference provider and controller', () => {
    const { getByTestId } = render(<RootLayout />);

    expect(getByTestId('orientation-provider')).toBeTruthy();
    expect(getByTestId('orientation-controller')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/root-layout.test.tsx
```

Expected: FAIL because `RootLayout` does not render `OrientationPreferenceProvider` or `OrientationPreferenceController`.

- [ ] **Step 3: Mount provider and controller**

Modify `apps/mobile/app/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { setArgon2Adapter } from '@keykeykey/core';
import { nativeArgon2Adapter } from '@/lib/native-argon2-adapter';
import { VaultProvider, useVault } from '@/lib/vault-context';
import { ThemeProvider, useTheme } from '@/lib/theme-provider';
import {
  OrientationPreferenceController,
  OrientationPreferenceProvider,
} from '@/lib/orientation-preference';

// Register native Argon2id adapter before any vault operations.
setArgon2Adapter(nativeArgon2Adapter);

function RootLayoutInner() {
  const { theme, isDark } = useTheme();
  const { onActivity, status } = useVault();
  const router = useRouter();

  useEffect(() => {
    if (status === 'locked') {
      router.replace('/unlock');
    } else if (status === 'needs_setup') {
      router.replace('/setup');
    }
  }, [status, router]);

  return (
    <View style={{ flex: 1 }} onTouchStart={onActivity}>
      <OrientationPreferenceController />
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: {
            backgroundColor: theme.colors.background,
          },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="setup" />
        <Stack.Screen name="unlock" />
        <Stack.Screen name="recovery" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="item/add"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="item/[id]"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="item/edit"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="item/qr-scan"
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="settings/sync"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="settings/import"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="settings/export"
          options={{ presentation: 'card', animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="restore"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <OrientationPreferenceProvider>
        <VaultProvider>
          <RootLayoutInner />
        </VaultProvider>
      </OrientationPreferenceProvider>
    </ThemeProvider>
  );
}
```

Keep the explanatory route-guard comment from the existing file if it is still present when editing; the snippet above shows the target structure, not an instruction to delete useful comments.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/root-layout.test.tsx __tests__/lib/orientation-preference.test.tsx __tests__/screens/unlock.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/__tests__/screens/root-layout.test.tsx
git commit -m "feat(mobile): apply orientation preference at root"
```

---

### Task 6: Settings Orientation Row

**Files:**

- Modify: `apps/mobile/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/__tests__/screens/settings.test.tsx`

- [ ] **Step 1: Write the failing test**

Modify `apps/mobile/__tests__/screens/settings.test.tsx`.

Add these mocks near the other mocks:

```tsx
const mockSetOrientationPreference = jest.fn().mockResolvedValue(undefined);
const mockOrientationState = {
  preference: 'system' as const,
  setPreference: mockSetOrientationPreference,
};

jest.mock('../../lib/orientation-preference', () => ({
  ORIENTATION_LABELS: {
    system: 'System',
    portrait: 'Portrait',
    landscape: 'Landscape',
    current: 'Lock current',
  },
  useOrientationPreference: () => mockOrientationState,
}));
```

Add these tests inside `describe('SettingsScreen', ...)`:

```tsx
it('shows orientation preference in appearance settings', () => {
  mockOrientationState.preference = 'system';

  const { getByText, getByTestId } = render(<SettingsScreen />);

  expect(getByText('Orientation')).toBeTruthy();
  expect(getByText('System')).toBeTruthy();
  expect(getByTestId('settings-orientation')).toBeTruthy();
});

it('persists selected orientation from Android-style options', async () => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const alertSpy = jest.spyOn(Alert, 'alert');
  const { getByTestId } = render(<SettingsScreen />);

  fireEvent.press(getByTestId('settings-orientation'));

  const [, , buttons] = alertSpy.mock.calls.find((call) => call[0] === 'Orientation')!;
  const landscapeButton = buttons!.find((button: any) => button.text === 'Landscape');
  landscapeButton.onPress();

  await waitFor(() => {
    expect(mockSetOrientationPreference).toHaveBeenCalledWith('landscape');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/settings.test.tsx
```

Expected: FAIL because Settings does not render an Orientation row.

- [ ] **Step 3: Implement Settings row and selection handler**

Modify imports in `apps/mobile/app/(tabs)/settings.tsx`:

```tsx
import {
  ORIENTATION_LABELS,
  type OrientationPreference,
  useOrientationPreference,
} from '@/lib/orientation-preference';
```

Add this constant near `AUTO_LOCK_OPTIONS`:

```tsx
const ORIENTATION_OPTIONS: Array<{ value: OrientationPreference; label: string }> = [
  { value: 'system', label: ORIENTATION_LABELS.system },
  { value: 'portrait', label: ORIENTATION_LABELS.portrait },
  { value: 'landscape', label: ORIENTATION_LABELS.landscape },
  { value: 'current', label: ORIENTATION_LABELS.current },
];
```

Inside `SettingsScreen`, add:

```tsx
const { preference: orientationPreference, setPreference: setOrientationPreference } =
  useOrientationPreference();
```

Add these handlers inside `SettingsScreen`:

```tsx
const handleOrientationSelect = async (value: OrientationPreference) => {
  try {
    await setOrientationPreference(value);
  } catch {
    Alert.alert('Error', 'Failed to save orientation preference.');
  }
};

const handleOrientationChange = () => {
  const labels = ORIENTATION_OPTIONS.map((opt) => opt.label);

  if (Platform.OS === 'ios') {
    const cancelIndex = labels.length;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, 'Cancel'],
        cancelButtonIndex: cancelIndex,
        title: 'Orientation',
      },
      (buttonIndex) => {
        if (buttonIndex !== cancelIndex) {
          void handleOrientationSelect(ORIENTATION_OPTIONS[buttonIndex]!.value);
        }
      },
    );
  } else {
    Alert.alert('Orientation', 'Choose how KeyKeyKey should handle screen orientation.', [
      ...ORIENTATION_OPTIONS.map((opt) => ({
        text: opt.label,
        onPress: () => void handleOrientationSelect(opt.value),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
};
```

In the Appearance section, below the existing Theme row, add:

```tsx
<SettingRow
  icon="phone-portrait-outline"
  label="Orientation"
  subtitle={ORIENTATION_LABELS[orientationPreference]}
  onPress={handleOrientationChange}
  testID="settings-orientation"
/>
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/screens/settings.test.tsx __tests__/lib/orientation-preference.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/\(tabs\)/settings.tsx apps/mobile/__tests__/screens/settings.test.tsx
git commit -m "feat(mobile): add orientation setting"
```

---

### Task 7: Final Verification

**Files:**

- Verify all changed mobile files.

- [ ] **Step 1: Run all focused tests from this plan**

Run:

```bash
pnpm --filter @keykeykey/mobile test -- __tests__/lib/use-is-wide-layout.test.tsx __tests__/components/TabletSidebarShell.test.tsx __tests__/screens/adaptive-tabs-layout.test.tsx __tests__/lib/orientation-preference.test.tsx __tests__/screens/settings.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run full mobile Jest suite**

Run:

```bash
pnpm --filter @keykeykey/mobile test
```

Expected: PASS.

- [ ] **Step 3: Run mobile typecheck**

Run:

```bash
pnpm --filter @keykeykey/mobile exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run mobile lint**

Run:

```bash
pnpm --filter @keykeykey/mobile lint
```

Expected: PASS.

- [ ] **Step 5: Run formatting check**

Run:

```bash
pnpm format:check
```

Expected: PASS.

- [ ] **Step 6: Manual simulator/device verification**

Run at least one iOS or Android build target available on the machine:

```bash
pnpm --filter @keykeykey/mobile ios
```

or:

```bash
pnpm --filter @keykeykey/mobile android
```

Manual checks:

- Width below 600dp shows bottom tabs.
- Width at or above 600dp shows the sidebar.
- Sidebar navigation reaches Vault, Authenticator, Generator, and Settings.
- Sidebar Lock Vault routes to `/unlock`.
- Settings -> Appearance -> Orientation persists each option.
- Android tablet or emulator uses the same 600dp behavior as iPad.
- App remains usable if the OS refuses an orientation lock.

- [ ] **Step 7: Commit final fixups**

If verification required any fixups:

```bash
git add apps/mobile apps/mobile/app.json apps/mobile/package.json pnpm-lock.yaml
git commit -m "fix(mobile): stabilize adaptive tablet shell"
```

If no fixups were needed, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage:
  - 600dp breakpoint: Task 1 and Task 3.
  - Bottom tabs below 600dp: Task 3.
  - Sidebar at 600dp and above: Task 2 and Task 3.
  - iOS and Android support: Task 4, Task 6, Task 7 manual checks.
  - Orientation setting: Task 4, Task 5, Task 6.
  - Static portrait lock removed: Task 4.
  - No master-detail Vault redesign: no task implements it.
- Type consistency:
  - `OrientationPreference` values are always `system | portrait | landscape | current`.
  - Sidebar route names are always `index | authenticator | generator | settings`.
  - The breakpoint constant is always `WIDE_LAYOUT_MIN_WIDTH = 600`.
- Placeholder scan:
  - No task contains placeholder markers or unspecified implementation work.
