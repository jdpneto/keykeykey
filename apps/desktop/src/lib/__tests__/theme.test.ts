import { describe, it, expect } from 'vitest';
import { lightTheme, darkTheme } from '../theme';

describe('theme', () => {
  describe('lightTheme', () => {
    it('has all required color keys', () => {
      const requiredKeys = [
        'primary', 'primaryMuted', 'background', 'surface', 'surfaceAlt',
        'text', 'textSecondary', 'border', 'inputBackground',
        'error', 'errorLight', 'success', 'successLight',
        'warning', 'warningLight', 'danger',
      ];
      for (const key of requiredKeys) {
        expect(lightTheme.colors).toHaveProperty(key);
        expect(typeof (lightTheme.colors as Record<string, string>)[key]).toBe('string');
      }
    });

    it('has spacing, radii, and typography', () => {
      expect(lightTheme.spacing).toBeDefined();
      expect(lightTheme.radii).toBeDefined();
      expect(lightTheme.typography).toBeDefined();
      expect(lightTheme.typography.sizes).toBeDefined();
      expect(lightTheme.typography.weights).toBeDefined();
    });
  });

  describe('darkTheme', () => {
    it('has same keys as lightTheme', () => {
      const lightKeys = Object.keys(lightTheme.colors).sort();
      const darkKeys = Object.keys(darkTheme.colors).sort();
      expect(darkKeys).toEqual(lightKeys);
    });

    it('has different background colors than light', () => {
      expect(darkTheme.colors.background).not.toBe(lightTheme.colors.background);
    });
  });
});
