import { describePlatformStorageConformance } from '@keykeykey/core/testing';

// --- Mock state (object refs so jest.mock factories can close over them) ---
const fileStore: Record<string, string> = {};
const fileExists: Record<string, boolean> = {};
const secureStore: Record<string, string> = {};
const sqliteRows: Array<{
  id: string;
  type: string;
  encrypted_data: string;
  created_at: string;
  updated_at: string;
}> = [];

// --- expo-file-system mock ---
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: jest.fn(async (path: string) => ({
    exists: fileExists[path] ?? false,
  })),
  readAsStringAsync: jest.fn(async (path: string) => fileStore[path] ?? ''),
  writeAsStringAsync: jest.fn(async (path: string, content: string) => {
    fileStore[path] = content;
    fileExists[path] = true;
  }),
  deleteAsync: jest.fn(async (path: string) => {
    delete fileStore[path];
    delete fileExists[path];
  }),
}));

// --- expo-secure-store mock ---
jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(async (key: string, value: string) => {
    secureStore[key] = value;
  }),
  getItemAsync: jest.fn(async (key: string) => secureStore[key] ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    delete secureStore[key];
  }),
}));

// --- expo-sqlite mock ---
const mockRunAsync = jest.fn(async (sql: string, params?: any[]) => {
  if (sql.includes('INSERT OR REPLACE')) {
    const [id, type, encrypted_data, created_at, updated_at] = params!;
    const idx = sqliteRows.findIndex((r) => r.id === id);
    const row = { id, type, encrypted_data, created_at, updated_at };
    if (idx >= 0) sqliteRows[idx] = row;
    else sqliteRows.push(row);
  } else if (sql.includes('DELETE') && params?.length) {
    const idx = sqliteRows.findIndex((r) => r.id === params[0]);
    if (idx >= 0) sqliteRows.splice(idx, 1);
  } else if (sql === 'DELETE FROM vault_items') {
    sqliteRows.length = 0;
  }
});
const mockGetAllAsync = jest.fn(async () => [...sqliteRows]);
const mockExecAsync = jest.fn(async () => {});

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => ({
    execAsync: mockExecAsync,
    runAsync: mockRunAsync,
    getAllAsync: mockGetAllAsync,
  })),
}));

// --- App Group path mock (mobile storage.ts tries to require it) ---
jest.mock('../modules/app-group-path', () => ({
  getAppGroupContainerPath: () => null,
}));

const { createMobilePlatformStorage } = require('../lib/sync');

function resetMockState() {
  Object.keys(fileStore).forEach((k) => delete fileStore[k]);
  Object.keys(fileExists).forEach((k) => delete fileExists[k]);
  Object.keys(secureStore).forEach((k) => delete secureStore[k]);
  sqliteRows.length = 0;
}

describePlatformStorageConformance('Mobile', () => {
  resetMockState();
  return createMobilePlatformStorage();
});
