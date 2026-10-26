import { useState } from 'react';
import type { ColorValue, OpaqueColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme-provider';
import { useVault } from '@/lib/vault-context';
import { QuickUnlockPrompt } from '@/components/QuickUnlockPrompt';
import { TabletSidebarShell } from '@/components/TabletSidebarShell';
import { useIsWideLayout } from '@/lib/use-is-wide-layout';

// RN 0.88 widened ColorValue to `null | string | number | NativeColorValue`,
// while @expo/vector-icons still types `color` as `string | OpaqueColorValue`.
// The tab bar always hands us a resolved tint (tabBarActive/InactiveTintColor),
// so only the nullable case needs mapping.
function tabBarIcon(name: keyof typeof Ionicons.glyphMap) {
  function TabBarIcon({ color, size }: { color: ColorValue; size: number }) {
    return (
      <Ionicons
        name={name}
        size={size}
        color={color === null ? undefined : (color as string | OpaqueColorValue)}
      />
    );
  }
  return TabBarIcon;
}

export default function TabLayout() {
  const { theme: t } = useTheme();
  const { status, quickUnlockPromptShown } = useVault();
  const isWideLayout = useIsWideLayout();
  const [promptDismissed, setPromptDismissed] = useState(false);

  const showQuickUnlockPrompt =
    status === 'unlocked' && !quickUnlockPromptShown && !promptDismissed;

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.colors.primary,
          tabBarInactiveTintColor: t.colors.textSecondary,
          tabBarPosition: isWideLayout ? 'left' : 'bottom',
          tabBarLabelPosition: isWideLayout ? 'beside-icon' : undefined,
          tabBarVariant: isWideLayout ? 'material' : 'uikit',
          tabBarStyle: {
            backgroundColor: t.colors.background,
            borderTopColor: isWideLayout ? 'transparent' : t.colors.border,
            borderTopWidth: isWideLayout ? 0 : 1,
          },
          tabBarLabelStyle: {
            fontSize: isWideLayout ? 14 : 11,
            fontWeight: '500',
          },
          sceneStyle: {
            backgroundColor: t.colors.background,
          },
        }}
        tabBar={isWideLayout ? (props) => <TabletSidebarShell {...props} /> : undefined}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Vault',
            tabBarButtonTestID: 'tab-vault',
            tabBarAccessibilityLabel: 'Vault',
            tabBarIcon: tabBarIcon('shield-outline'),
          }}
        />
        <Tabs.Screen
          name="authenticator"
          options={{
            title: 'Authenticator',
            tabBarButtonTestID: 'tab-authenticator',
            tabBarAccessibilityLabel: 'Authenticator',
            tabBarIcon: tabBarIcon('shield-checkmark-outline'),
          }}
        />
        <Tabs.Screen
          name="generator"
          options={{
            title: 'Generator',
            tabBarButtonTestID: 'tab-generator',
            tabBarAccessibilityLabel: 'Generator',
            tabBarIcon: tabBarIcon('dice-outline'),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarButtonTestID: 'tab-settings',
            tabBarAccessibilityLabel: 'Settings',
            tabBarIcon: tabBarIcon('settings-outline'),
          }}
        />
      </Tabs>

      {showQuickUnlockPrompt && <QuickUnlockPrompt onDismiss={() => setPromptDismissed(true)} />}
    </>
  );
}
