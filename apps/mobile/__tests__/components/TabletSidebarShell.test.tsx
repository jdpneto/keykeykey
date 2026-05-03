import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TabletSidebarShell } from '../../components/TabletSidebarShell';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  Tabs: jest.fn(),
  useRouter: () => ({ replace: mockReplace }),
}));

const mockLock = jest.fn();
const mockVaultState = {
  lock: mockLock,
};

jest.mock('@/lib/vault-context', () => ({
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
  });

  it('renders brand, nav items, and lock action', () => {
    const { getByText, getByTestId } = render(<TabletSidebarShell {...makeProps()} />);

    expect(getByTestId('tablet-sidebar')).toBeTruthy();
    expect(getByText('KeyKeyKey')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-vault')).toBeTruthy();
    expect(getByText('Vault')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-authenticator')).toBeTruthy();
    expect(getByText('Authenticator')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-generator')).toBeTruthy();
    expect(getByText('Generator')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-settings')).toBeTruthy();
    expect(getByText('Settings')).toBeTruthy();
    expect(getByTestId('tablet-sidebar-lock')).toBeTruthy();
    expect(getByText('Lock Vault')).toBeTruthy();
  });

  it('pressing authenticator emits tabPress and navigates', () => {
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

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'generator-key',
      canPreventDefault: true,
    });
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });

  it('pressing lock calls lock and routes to unlock', () => {
    const { getByTestId } = render(<TabletSidebarShell {...makeProps()} />);

    fireEvent.press(getByTestId('tablet-sidebar-lock'));

    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/unlock');
  });
});
