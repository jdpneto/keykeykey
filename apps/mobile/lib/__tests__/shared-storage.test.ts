jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

// We can't deeply test storage without native modules, but we can verify
// the re-export module compiles and exports the expected interface.
describe('shared-storage module', () => {
  it('should be importable', () => {
    // Dynamic import to avoid native module initialization errors in test
    const mod = require('../shared-storage');
    expect(typeof mod.saveVaultHeader).toBe('function');
    expect(typeof mod.loadVaultHeader).toBe('function');
    expect(typeof mod.getDB).toBe('function');
    expect(typeof mod.saveEncryptedItem).toBe('function');
    expect(typeof mod.loadAllEncryptedItems).toBe('function');
    expect(typeof mod.deleteEncryptedItem).toBe('function');
  });
});
