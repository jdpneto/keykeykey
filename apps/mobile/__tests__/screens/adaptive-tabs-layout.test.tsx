import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import TabLayout from '../../app/(tabs)/_layout';
import { mockThemeValue } from '../helpers/mock-theme';

const mockUseIsWideLayout = jest.fn();
const mockTabletSidebarShell = jest.fn();
const mockQuickUnlockPrompt = jest.fn();
const mockTabs = jest.fn();
const mockTabsScreen = jest.fn();
const mockTabBarProps = {
  state: {
    key: 'tab-state',
    index: 0,
    routes: [{ key: 'index-key', name: 'index', params: undefined }],
  },
  descriptors: {},
  navigation: {},
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

const mockVaultState = {
  status: 'unlocked',
  quickUnlockPromptShown: false,
};

jest.mock('@/lib/use-is-wide-layout', () => ({
  useIsWideLayout: () => mockUseIsWideLayout(),
}));

jest.mock('@/components/TabletSidebarShell', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    TabletSidebarShell: (props: any) => {
      mockTabletSidebarShell(props);
      return React.createElement(View, { testID: 'tablet-sidebar-shell' });
    },
  };
});

jest.mock('@/components/QuickUnlockPrompt', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    QuickUnlockPrompt: (props: any) => {
      mockQuickUnlockPrompt(props);
      return React.createElement(View, { testID: 'quick-unlock-prompt' });
    },
  };
});

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  function Tabs(props: any) {
    mockTabs(props);

    return React.createElement(
      View,
      { testID: 'tabs' },
      props.tabBar ? props.tabBar(mockTabBarProps) : null,
      props.children,
    );
  }

  Tabs.Screen = (props: any) => {
    mockTabsScreen(props);
    return React.createElement(View, { testID: `tab-screen-${props.name}` });
  };

  return { Tabs };
});

jest.mock('@/lib/vault-context', () => ({
  useVault: () => mockVaultState,
}));

jest.mock('@/lib/theme-provider', () => ({
  useTheme: () => mockThemeValue,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

function getTabsProps() {
  return mockTabs.mock.calls[0][0];
}

function getScreenOptions() {
  return getTabsProps().screenOptions;
}

function flattenStyle(style: unknown) {
  return StyleSheet.flatten(style);
}

describe('adaptive tabs layout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVaultState.status = 'unlocked';
    mockVaultState.quickUnlockPromptShown = false;
  });

  it('renders bottom tabs without the tablet sidebar on narrow widths', () => {
    mockUseIsWideLayout.mockReturnValue(false);

    const { queryByTestId, getByTestId } = render(<TabLayout />);
    const screenOptions = getScreenOptions();

    expect(getByTestId('tabs')).toBeTruthy();
    expect(queryByTestId('tablet-sidebar-shell')).toBeNull();
    expect(mockTabletSidebarShell).not.toHaveBeenCalled();
    expect(getTabsProps().tabBar).toBeUndefined();
    expect(screenOptions.tabBarPosition).not.toBe('left');
    expect(screenOptions.tabBarLabelPosition).not.toBe('beside-icon');
    expect(screenOptions.tabBarVariant).toBe('uikit');
    expect(screenOptions.tabBarLabelStyle).toMatchObject({
      fontSize: 11,
      fontWeight: '500',
    });
    expect(flattenStyle(screenOptions.tabBarStyle)).toMatchObject({
      backgroundColor: mockThemeValue.theme.colors.background,
      borderTopColor: mockThemeValue.theme.colors.border,
      borderTopWidth: 1,
    });
    expect(mockQuickUnlockPrompt).toHaveBeenCalledTimes(1);
  });

  it('renders left tabs with the tablet sidebar on wide widths', () => {
    mockUseIsWideLayout.mockReturnValue(true);

    const { getByTestId } = render(<TabLayout />);
    const screenOptions = getScreenOptions();

    expect(getByTestId('tablet-sidebar-shell')).toBeTruthy();
    expect(mockTabletSidebarShell).toHaveBeenCalledWith(mockTabBarProps);
    expect(getTabsProps().tabBar).toEqual(expect.any(Function));
    expect(screenOptions.tabBarPosition).toBe('left');
    expect(screenOptions.tabBarLabelPosition).toBe('beside-icon');
    expect(screenOptions.tabBarVariant).toBe('material');
    expect(screenOptions.tabBarLabelStyle).toMatchObject({
      fontSize: 14,
      fontWeight: '500',
    });
    expect(flattenStyle(screenOptions.tabBarStyle)).toMatchObject({
      backgroundColor: mockThemeValue.theme.colors.background,
      borderTopWidth: 0,
    });
    expect(screenOptions.sceneStyle).toMatchObject({
      backgroundColor: mockThemeValue.theme.colors.background,
    });
    expect(mockQuickUnlockPrompt).toHaveBeenCalledTimes(1);
  });
});
