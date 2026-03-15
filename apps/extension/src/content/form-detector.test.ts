import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectLoginForms, observeFormChanges } from './form-detector';

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('detectLoginForms', () => {
  it('detects form with type="password" + text input', () => {
    const form = document.createElement('form');
    const username = document.createElement('input');
    username.type = 'text';
    username.name = 'username';
    const password = document.createElement('input');
    password.type = 'password';
    form.appendChild(username);
    form.appendChild(password);
    document.body.appendChild(form);

    const result = detectLoginForms();
    expect(result).toHaveLength(1);
    expect(result[0].passwordField).toBe(password);
    expect(result[0].usernameField).toBe(username);
    expect(result[0].formElement).toBe(form);
  });

  it('detects by autocomplete attribute', () => {
    const form = document.createElement('form');
    const username = document.createElement('input');
    username.setAttribute('autocomplete', 'username');
    const password = document.createElement('input');
    password.setAttribute('autocomplete', 'current-password');
    form.appendChild(username);
    form.appendChild(password);
    document.body.appendChild(form);

    const result = detectLoginForms();
    expect(result).toHaveLength(1);
    expect(result[0].passwordField).toBe(password);
    expect(result[0].usernameField).toBe(username);
  });

  it('detects by name/id pattern (e.g., id="user-email")', () => {
    const form = document.createElement('form');
    const username = document.createElement('input');
    username.type = 'text';
    username.id = 'user-email';
    const password = document.createElement('input');
    password.type = 'password';
    form.appendChild(username);
    form.appendChild(password);
    document.body.appendChild(form);

    const result = detectLoginForms();
    expect(result).toHaveLength(1);
    expect(result[0].usernameField).toBe(username);
  });

  it('returns empty for pages without login forms', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    div.appendChild(input);
    document.body.appendChild(div);

    const result = detectLoginForms();
    expect(result).toHaveLength(0);
  });

  it('returns null usernameField when none is found', () => {
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    form.appendChild(password);
    document.body.appendChild(form);

    const result = detectLoginForms();
    expect(result).toHaveLength(1);
    expect(result[0].usernameField).toBeNull();
  });

  it('detects multiple login forms', () => {
    for (let i = 0; i < 2; i++) {
      const form = document.createElement('form');
      const password = document.createElement('input');
      password.type = 'password';
      form.appendChild(password);
      document.body.appendChild(form);
    }

    const result = detectLoginForms();
    expect(result).toHaveLength(2);
  });
});

describe('observeFormChanges', () => {
  it('detects dynamically added forms via callback', async () => {
    const callback = vi.fn();
    const disconnect = observeFormChanges(callback);

    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    form.appendChild(password);
    document.body.appendChild(form);

    // Wait for debounce (100ms) + mutation observer async
    await vi.waitFor(
      () => {
        expect(callback).toHaveBeenCalled();
      },
      { timeout: 500 },
    );

    const callArg = callback.mock.calls[0][0];
    expect(callArg).toHaveLength(1);
    expect(callArg[0].passwordField).toBe(password);

    disconnect();
  });

  it('returns a disconnect function that stops observing', async () => {
    const callback = vi.fn();
    const disconnect = observeFormChanges(callback);
    disconnect();

    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    form.appendChild(password);
    document.body.appendChild(form);

    // Wait enough time to confirm callback is NOT called
    await new Promise((r) => setTimeout(r, 200));
    expect(callback).not.toHaveBeenCalled();
  });
});
