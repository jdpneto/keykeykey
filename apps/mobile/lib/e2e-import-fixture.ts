export interface E2eCsvImportFixture {
  name: string;
  uri: string;
}

type Env = Record<string, string | undefined>;

const CSV_FIXTURE_NAME = 'chrome.csv';
const CSV_FIXTURE_RELATIVE_PATH = 'e2e/fixtures/password-imports/chrome.csv';

export function getE2eCsvImportFixture(
  documentDirectory: string | null | undefined,
  env: Env = process.env,
  appConfigEnabled = false,
): E2eCsvImportFixture | null {
  if ((!appConfigEnabled && env.EXPO_PUBLIC_E2E_IMPORT_FIXTURE !== '1') || !documentDirectory) {
    return null;
  }

  return {
    name: CSV_FIXTURE_NAME,
    uri: `${documentDirectory}${CSV_FIXTURE_RELATIVE_PATH}`,
  };
}
