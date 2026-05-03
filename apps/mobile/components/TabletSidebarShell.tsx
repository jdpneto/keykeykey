import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
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
  {
    routeName: 'index',
    label: 'Vault',
    icon: 'shield-outline',
    testID: 'tablet-sidebar-vault',
  },
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

export function TabletSidebarShell({ state, navigation, insets }: TabBarProps) {
  const { theme: t } = useTheme();
  const { lock } = useVault();
  const router = useRouter();
  const activeRouteName = state.routes[state.index]?.name;

  const navigateTo = (routeName: RouteName) => {
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
    lock();
    router.replace('/unlock');
  };

  return (
    <View
      testID="tablet-sidebar"
      style={[
        styles.container,
        {
          backgroundColor: t.colors.surface,
          borderRightColor: t.colors.border,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 16,
        },
      ]}
    >
      <Text style={[styles.brand, { color: t.colors.primary }]}>KeyKeyKey</Text>

      <View style={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeRouteName === item.routeName;
          const foreground = isActive ? t.colors.text : t.colors.textSecondary;

          return (
            <Pressable
              key={item.routeName}
              testID={item.testID}
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              onPress={() => navigateTo(item.routeName)}
              style={({ pressed }) => [
                styles.navItem,
                {
                  backgroundColor: isActive || pressed ? t.colors.surfaceAlt : 'transparent',
                  borderRightColor: isActive ? t.colors.primary : 'transparent',
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Ionicons name={item.icon} size={18} color={foreground} />
              <Text
                numberOfLines={1}
                style={[
                  styles.navLabel,
                  {
                    color: foreground,
                    fontWeight: isActive ? '600' : '400',
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
        accessibilityLabel="Lock Vault"
        accessibilityRole="button"
        onPress={handleLock}
        style={({ pressed }) => [
          styles.lockButton,
          {
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Ionicons name="lock-closed-outline" size={18} color={t.colors.textSecondary} />
        <Text numberOfLines={1} style={[styles.lockLabel, { color: t.colors.textSecondary }]}>
          Lock Vault
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 220,
    minWidth: 220,
    alignSelf: 'stretch',
    borderRightWidth: 1,
    paddingHorizontal: 0,
  },
  brand: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    fontSize: 18,
    fontWeight: '700',
  },
  nav: {
    flex: 1,
    gap: 2,
  },
  navItem: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderRightWidth: 3,
  },
  navLabel: {
    flex: 1,
    fontSize: 14,
  },
  lockButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    borderRightWidth: 3,
    borderRightColor: 'transparent',
  },
  lockLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
  },
});
