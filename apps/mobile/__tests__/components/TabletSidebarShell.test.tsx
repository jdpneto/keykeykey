import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
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

function flattenRenderedStyle(style: unknown) {
  return StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style);
}

function makeProps(overrides: Record<string, unknown> = {}) {
  const routes = [
    { key: 'index-key', name: 'index', params: undefined },
    { key: 'auth-key', name: 'authenticator', params: undefined },
    { key: 'generator-key', name: 'generator', params: undefined },
    { key: 'settings-key', name: 'settings', params: undefined },
  ];

  return {
    state: {
      index: 0,
      routes,
    },
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])),
    emitter: {
      emit: jest.fn(() => ({ defaultPrevented: false })),
    },
    navigateToTab: jest.fn(),
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides,
  } as any;
}

describe('TabletSidebarShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders brand, nav items, and lock action', async () => {
    const { getByText, getByTestId } = await render(<TabletSidebarShell {...makeProps()} />);

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

  it('pressing authenticator emits tabPress and navigates', async () => {
    const props = makeProps();
    const { getByTestId } = await render(<TabletSidebarShell {...props} />);

    await fireEvent.press(getByTestId('tablet-sidebar-authenticator'));

    expect(props.emitter.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'auth-key',
      canPreventDefault: true,
    });
    expect(props.navigateToTab).toHaveBeenCalledWith('auth-key');
  });

  it('does not navigate when tabPress is prevented', async () => {
    const props = makeProps({
      emitter: {
        emit: jest.fn(() => ({ defaultPrevented: true })),
      },
    });
    const { getByTestId } = await render(<TabletSidebarShell {...props} />);

    await fireEvent.press(getByTestId('tablet-sidebar-generator'));

    expect(props.emitter.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'generator-key',
      canPreventDefault: true,
    });
    expect(props.navigateToTab).not.toHaveBeenCalled();
  });

  it('pressing lock calls lock and routes to unlock', async () => {
    const { getByTestId } = await render(<TabletSidebarShell {...makeProps()} />);

    await fireEvent.press(getByTestId('tablet-sidebar-lock'));

    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/unlock');
  });

  it('accounts for a left safe-area inset in width and row padding', async () => {
    const props = makeProps({
      insets: { top: 0, right: 0, bottom: 0, left: 34 },
    });
    const { getByTestId, getByText } = await render(<TabletSidebarShell {...props} />);

    expect(flattenRenderedStyle(getByTestId('tablet-sidebar').props.style)).toMatchObject({
      width: 254,
      minWidth: 254,
    });
    expect(flattenRenderedStyle(getByText('KeyKeyKey').props.style)).toMatchObject({
      paddingLeft: 54,
      paddingRight: 20,
    });
    expect(flattenRenderedStyle(getByTestId('tablet-sidebar-vault').props.style)).toMatchObject({
      paddingLeft: 54,
      paddingRight: 20,
    });
    expect(flattenRenderedStyle(getByTestId('tablet-sidebar-lock').props.style)).toMatchObject({
      paddingLeft: 54,
      paddingRight: 20,
    });
  });
});
