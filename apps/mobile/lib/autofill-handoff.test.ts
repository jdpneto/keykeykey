import { AutofillHandoff } from './autofill-handoff';

describe('AutofillHandoff', () => {
  beforeEach(() => {
    AutofillHandoff.clear();
  });

  it('should store and retrieve pending credentials', () => {
    AutofillHandoff.setPending({
      username: 'user@example.com',
      password: 'secret123',
      packageName: 'com.slack.android',
      domain: 'slack.com',
    });
    const pending = AutofillHandoff.consume();
    expect(pending).toEqual({
      username: 'user@example.com',
      password: 'secret123',
      packageName: 'com.slack.android',
      domain: 'slack.com',
    });
  });

  it('should clear after consume (one-time read)', () => {
    AutofillHandoff.setPending({
      username: 'user',
      password: 'pass',
      packageName: 'com.test.app',
    });
    AutofillHandoff.consume();
    expect(AutofillHandoff.consume()).toBeNull();
  });

  it('should return null when nothing is pending', () => {
    expect(AutofillHandoff.consume()).toBeNull();
  });

  it('should allow clearing without consuming', () => {
    AutofillHandoff.setPending({
      username: 'user',
      password: 'pass',
      packageName: 'com.test.app',
    });
    AutofillHandoff.clear();
    expect(AutofillHandoff.consume()).toBeNull();
  });
});
