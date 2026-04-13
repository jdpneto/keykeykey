import React from 'react';
import type { Settings, AutoLockMode } from '../../../lib/messages.js';

const AUTO_LOCK_MODES: { value: AutoLockMode; label: string }[] = [
  { value: 'timed', label: 'After timeout' },
  { value: 'browser_close', label: 'On browser close' },
  { value: 'never', label: 'Never' },
];

const AUTO_LOCK_OPTIONS = [
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 480, label: '8 hours' },
  { value: 1440, label: '24 hours' },
] as const;

interface AutoLockSettingsProps {
  settings: Settings | null;
  onUpdateSetting: (updates: Partial<Settings>) => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  sectionStyle: React.CSSProperties;
  sectionHeaderStyle: React.CSSProperties;
}

export function AutoLockSettings({
  settings,
  onUpdateSetting,
  inputStyle,
  labelStyle,
  sectionStyle,
  sectionHeaderStyle,
}: AutoLockSettingsProps) {
  return (
    <>
      <div style={sectionHeaderStyle}>Auto-Lock</div>
      <div style={sectionStyle}>
        <div style={{ marginBottom: 8 }}>
          <label style={labelStyle}>Lock when</label>
          <select
            value={settings?.autoLockMode ?? 'timed'}
            onChange={(e) => onUpdateSetting({ autoLockMode: e.target.value as AutoLockMode })}
            style={inputStyle}
          >
            {AUTO_LOCK_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        {settings?.autoLockMode === 'timed' && (
          <div>
            <label style={labelStyle}>Timeout</label>
            <select
              value={settings?.autoLockMinutes ?? 60}
              onChange={(e) => onUpdateSetting({ autoLockMinutes: Number(e.target.value) })}
              style={inputStyle}
            >
              {AUTO_LOCK_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </>
  );
}
