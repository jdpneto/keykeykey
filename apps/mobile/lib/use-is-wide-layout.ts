import { useWindowDimensions } from 'react-native';

export const WIDE_LAYOUT_MIN_WIDTH = 600;

export function useIsWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_LAYOUT_MIN_WIDTH;
}
