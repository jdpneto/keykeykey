import { renderHook } from '@testing-library/react-native';
import { useWindowDimensions } from 'react-native';
import { WIDE_LAYOUT_MIN_WIDTH, useIsWideLayout } from '../../lib/use-is-wide-layout';

jest.mock('react-native', () => ({
  useWindowDimensions: jest.fn(),
}));

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
