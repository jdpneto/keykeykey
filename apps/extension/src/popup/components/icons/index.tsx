import React from 'react';

interface IconProps {
  size?: number;
  color?: string;
}

function makeSvg(size: number, color: string, children: React.ReactNode): React.ReactElement {
  return React.createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    children,
  );
}

export function SyncIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('polyline', { key: 'p1', points: '21 2 21 8 15 8' }),
    React.createElement('polyline', { key: 'p2', points: '3 16 3 22 9 22' }),
    React.createElement('path', { key: 'a1', d: 'M3 12a9 9 0 0 1 15-6.7L21 8' }),
    React.createElement('path', { key: 'a2', d: 'M21 12a9 9 0 0 1-15 6.7L3 16' }),
  ]);
}

export function PlusIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 10 }),
    React.createElement('line', { key: 'v', x1: 12, y1: 8, x2: 12, y2: 16 }),
    React.createElement('line', { key: 'h', x1: 8, y1: 12, x2: 16, y2: 12 }),
  ]);
}

export function DiceIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('rect', { key: 'r', x: 3, y: 3, width: 18, height: 18, rx: 3 }),
    React.createElement('circle', { key: 'd1', cx: 8.5, cy: 8.5, r: 1.5, fill: color }),
    React.createElement('circle', { key: 'd2', cx: 15.5, cy: 8.5, r: 1.5, fill: color }),
    React.createElement('circle', { key: 'd3', cx: 8.5, cy: 15.5, r: 1.5, fill: color }),
    React.createElement('circle', { key: 'd4', cx: 15.5, cy: 15.5, r: 1.5, fill: color }),
  ]);
}

export function LockIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('rect', { key: 'r', x: 3, y: 11, width: 18, height: 11, rx: 2 }),
    React.createElement('path', { key: 'p', d: 'M7 11V7a5 5 0 0 1 10 0v4' }),
  ]);
}

export function ShieldIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('path', {
      key: 'shield',
      d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    }),
    React.createElement('path', { key: 'check', d: 'm9 12 2 2 4-4' }),
  ]);
}

export function GearIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
    React.createElement('path', {
      key: 'p',
      d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
    }),
  ]);
}

export function EyeIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('path', {
      key: 'outline',
      d: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z',
    }),
    React.createElement('circle', { key: 'pupil', cx: 12, cy: 12, r: 3 }),
  ]);
}

export function EyeOffIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('path', {
      key: 'p1',
      d: 'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94',
    }),
    React.createElement('path', {
      key: 'p2',
      d: 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19',
    }),
    React.createElement('path', {
      key: 'p3',
      d: 'M14.12 14.12a3 3 0 1 1-4.24-4.24',
    }),
    React.createElement('line', { key: 'slash', x1: 1, y1: 1, x2: 23, y2: 23 }),
  ]);
}

export function RefreshIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('polyline', { key: 'p1', points: '23 4 23 10 17 10' }),
    React.createElement('polyline', { key: 'p2', points: '1 20 1 14 7 14' }),
    React.createElement('path', {
      key: 'arc',
      d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
    }),
  ]);
}

export function UploadIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('path', { key: 'p1', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    React.createElement('polyline', { key: 'p2', points: '17 8 12 3 7 8' }),
    React.createElement('line', { key: 'l', x1: 12, y1: 3, x2: 12, y2: 15 }),
  ]);
}

export function DownloadIcon({ size = 20, color = 'currentColor' }: IconProps): React.ReactElement {
  return makeSvg(size, color, [
    React.createElement('path', { key: 'p1', d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
    React.createElement('polyline', { key: 'p2', points: '7 10 12 15 17 10' }),
    React.createElement('line', { key: 'l', x1: 12, y1: 15, x2: 12, y2: 3 }),
  ]);
}
