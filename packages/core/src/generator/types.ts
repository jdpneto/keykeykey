export type PasswordMode = 'random' | 'passphrase';

export type PasswordStrength = 'weak' | 'fair' | 'strong' | 'very-strong';

export interface RandomOptions {
  mode: 'random';
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export interface PassphraseOptions {
  mode: 'passphrase';
  wordCount: number;
  separator: string;
  capitalize: boolean;
  appendNumber: boolean;
}

export type PasswordGeneratorOptions = RandomOptions | PassphraseOptions;

export const DEFAULT_RANDOM_OPTIONS: RandomOptions = {
  mode: 'random',
  length: 20,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  mode: 'passphrase',
  wordCount: 5,
  separator: '-',
  capitalize: true,
  appendNumber: true,
};
