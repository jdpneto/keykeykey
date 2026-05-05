import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockStack = jest.fn();
const mockStackScreen = jest.fn();
const mockStatusBar = jest.fn();
const mockSetArgon2Adapter = jest.fn();
const mockNativeArgon2Adapter = { hash: jest.fn() };
const mockOnActivity = jest.fn();
const mockThemeProvider = jest.fn();
const mockVaultProvider = jest.fn();
const mockOrientationPreferenceProvider = jest.fn();
const mockOrientationPreferenceController = jest.fn();

const mockThemeValue = {
  theme: {
    colors: {
      background: '#ffffff',
    },
  },
  isDark: false,
};

const mockVaultState = {
  status: 'unlocked',
  onActivity: mockOnActivity,
};

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  function Stack(props: any) {
    mockStack(props);
    return React.createElement(View, { testID: 'root-stack' }, props.children);
  }

  (Stack as any).Screen = (props: any) => {
    mockStackScreen(props);
    return React.createElement(View, { testID: `stack-screen-${props.name}` });
  };

  return {
    Stack,
    useRouter: () => ({ replace: mockReplace }),
  };
});

jest.mock('expo-status-bar', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    StatusBar: (props: any) => {
      mockStatusBar(props);
      return React.createElement(View, { testID: 'status-bar', ...props });
    },
  };
});

jest.mock('@keykeykey/core', () => ({
  setArgon2Adapter: mockSetArgon2Adapter,
}));

jest.mock('@/lib/native-argon2-adapter', () => ({
  nativeArgon2Adapter: mockNativeArgon2Adapter,
}));

jest.mock('@/lib/theme-provider', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    ThemeProvider: ({ children }: any) => {
      mockThemeProvider({ children });
      return React.createElement(View, { testID: 'theme-provider' }, children);
    },
    useTheme: () => mockThemeValue,
  };
});

jest.mock('@/lib/vault-context', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    VaultProvider: ({ children }: any) => {
      mockVaultProvider({ children });
      return React.createElement(View, { testID: 'vault-provider' }, children);
    },
    useVault: () => mockVaultState,
  };
});

jest.mock('@/lib/orientation-preference', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    OrientationPreferenceProvider: ({ children }: any) => {
      mockOrientationPreferenceProvider({ children });
      return React.createElement(View, { testID: 'orientation-preference-provider' }, children);
    },
    OrientationPreferenceController: () => {
      mockOrientationPreferenceController();
      return React.createElement(View, { testID: 'orientation-preference-controller' });
    },
  };
});

const RootLayout = require('../../app/_layout').default;

function getChildTestIds(node: any): string[] {
  return (node?.children ?? [])
    .map((child: any) => child?.props?.testID)
    .filter((testID: string | undefined): testID is string => Boolean(testID));
}

describe('RootLayout', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockStack.mockClear();
    mockStackScreen.mockClear();
    mockStatusBar.mockClear();
    mockNativeArgon2Adapter.hash.mockClear();
    mockOnActivity.mockClear();
    mockThemeProvider.mockClear();
    mockVaultProvider.mockClear();
    mockOrientationPreferenceProvider.mockClear();
    mockOrientationPreferenceController.mockClear();
    mockVaultState.status = 'unlocked';
    mockThemeValue.isDark = false;
    mockThemeValue.theme.colors.background = '#ffffff';
  });

  it('registers the native Argon2 adapter when the layout module loads', () => {
    expect(mockSetArgon2Adapter).toHaveBeenCalledWith(mockNativeArgon2Adapter);
  });

  it('wraps the vault tree with the orientation preference provider inside the theme provider', () => {
    const { toJSON } = render(<RootLayout />);
    const tree = toJSON() as any;
    const orientationProvider = tree.children[0];
    const vaultProvider = orientationProvider.children[0];

    expect(tree.props.testID).toBe('theme-provider');
    expect(orientationProvider.props.testID).toBe('orientation-preference-provider');
    expect(vaultProvider.props.testID).toBe('vault-provider');
    expect(mockOrientationPreferenceProvider).toHaveBeenCalledTimes(1);
  });

  it('renders the orientation preference controller inside the app root before chrome', () => {
    const { toJSON, getByTestId } = render(<RootLayout />);
    const tree = toJSON() as any;
    const appRoot = tree.children[0].children[0].children[0];

    expect(getByTestId('orientation-preference-controller')).toBeTruthy();
    expect(getChildTestIds(appRoot)).toEqual([
      'orientation-preference-controller',
      'status-bar',
      'root-stack',
    ]);
    expect(appRoot.props.onTouchStart).toBe(mockOnActivity);
    expect(mockOrientationPreferenceController).toHaveBeenCalledTimes(1);
  });

  it('renders the root stack and status bar with existing screen options', () => {
    const { getByTestId } = render(<RootLayout />);

    expect(getByTestId('status-bar')).toBeTruthy();
    expect(mockStatusBar).toHaveBeenCalledWith(expect.objectContaining({ style: 'dark' }));
    expect(getByTestId('root-stack')).toBeTruthy();
    expect(mockStack).toHaveBeenCalledWith(
      expect.objectContaining({
        screenOptions: expect.objectContaining({
          headerShown: false,
          contentStyle: { backgroundColor: '#ffffff' },
          animation: 'fade',
        }),
      }),
    );
    expect(mockStackScreen).toHaveBeenCalledWith(expect.objectContaining({ name: 'index' }));
    expect(mockStackScreen).toHaveBeenCalledWith(expect.objectContaining({ name: 'setup' }));
    expect(mockStackScreen).toHaveBeenCalledWith(expect.objectContaining({ name: 'unlock' }));
    expect(mockStackScreen).toHaveBeenCalledWith(expect.objectContaining({ name: '(tabs)' }));
  });

  it('keeps routing locked vaults to unlock', async () => {
    mockVaultState.status = 'locked';

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/unlock');
    });
  });

  it('keeps routing vaults that need setup to setup', async () => {
    mockVaultState.status = 'needs_setup';

    render(<RootLayout />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/setup');
    });
  });
});
