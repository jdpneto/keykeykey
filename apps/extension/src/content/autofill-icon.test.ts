import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  injectAutofillIcon,
  removeAllAutofillIcons,
  fillCredential,
  isSecureContext,
} from './autofill-icon';
import type { LoginForm } from './form-detector';

afterEach(() => {
  removeAllAutofillIcons();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
});

describe('injectAutofillIcon', () => {
  it('creates a shadow DOM host element near the field', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
  });

  it('renders icon with correct ARIA attributes', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const icon = host.shadowRoot!.querySelector('[role="button"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('aria-label')).toBe('Autofill credentials');
  });

  it('renders dropdown with role="listbox"', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const dropdown = host.shadowRoot!.querySelector('[role="listbox"]');
    expect(dropdown).not.toBeNull();
  });

  it('opens dropdown on icon click and displays credentials', async () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    const creds = [{ id: '1', name: 'Test', username: 'user@test.com' }];
    injectAutofillIcon(field, vi.fn().mockResolvedValue(creds), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const icon = host.shadowRoot!.querySelector('[role="button"]') as HTMLElement;
    icon.click();

    // Wait for async onGetCredentials
    await vi.waitFor(() => {
      const items = host.shadowRoot!.querySelectorAll('[role="option"]');
      expect(items).toHaveLength(1);
    });
  });

  it('calls onSelectCredential when a credential item is clicked', async () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    const onSelect = vi.fn().mockResolvedValue(undefined);
    const creds = [{ id: '42', name: 'Site', username: 'me@site.com' }];
    injectAutofillIcon(field, vi.fn().mockResolvedValue(creds), onSelect);

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const icon = host.shadowRoot!.querySelector('[role="button"]') as HTMLElement;
    icon.click();

    await vi.waitFor(() => {
      const items = host.shadowRoot!.querySelectorAll('[role="option"]');
      expect(items).toHaveLength(1);
    });

    const item = host.shadowRoot!.querySelector('[role="option"]') as HTMLElement;
    item.click();
    expect(onSelect).toHaveBeenCalledWith('42');
  });
});

describe('removeAllAutofillIcons', () => {
  it('removes all injected shadow DOM containers', () => {
    const field1 = document.createElement('input');
    field1.type = 'password';
    document.body.appendChild(field1);
    const field2 = document.createElement('input');
    field2.type = 'password';
    document.body.appendChild(field2);

    injectAutofillIcon(field1, vi.fn().mockResolvedValue([]), vi.fn());
    injectAutofillIcon(field2, vi.fn().mockResolvedValue([]), vi.fn());

    expect(document.querySelectorAll('.keykeykey-autofill-host')).toHaveLength(2);

    removeAllAutofillIcons();

    expect(document.querySelectorAll('.keykeykey-autofill-host')).toHaveLength(0);
  });
});

describe('fillCredential', () => {
  it('fills username and password fields using native setter', () => {
    const username = document.createElement('input');
    username.type = 'text';
    const password = document.createElement('input');
    password.type = 'password';
    document.body.appendChild(username);
    document.body.appendChild(password);

    const form: LoginForm = {
      usernameField: username,
      passwordField: password,
      formElement: null,
    };

    const inputSpy = vi.fn();
    const changeSpy = vi.fn();
    username.addEventListener('input', inputSpy);
    username.addEventListener('change', changeSpy);
    password.addEventListener('input', inputSpy);
    password.addEventListener('change', changeSpy);

    fillCredential(form, 'testuser', 'testpass');

    expect(username.value).toBe('testuser');
    expect(password.value).toBe('testpass');
    expect(inputSpy).toHaveBeenCalledTimes(2);
    expect(changeSpy).toHaveBeenCalledTimes(2);
  });

  it('fills only password when usernameField is null', () => {
    const password = document.createElement('input');
    password.type = 'password';
    document.body.appendChild(password);

    const form: LoginForm = {
      usernameField: null,
      passwordField: password,
      formElement: null,
    };

    fillCredential(form, 'user', 'pass123');
    expect(password.value).toBe('pass123');
  });
});

describe('isSecureContext', () => {
  it('returns true for https protocol', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'https:', hostname: 'example.com' },
      writable: true,
      configurable: true,
    });
    expect(isSecureContext()).toBe(true);
  });

  it('returns true for localhost', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: 'localhost' },
      writable: true,
      configurable: true,
    });
    expect(isSecureContext()).toBe(true);
  });

  it('returns false for non-secure context', () => {
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:', hostname: 'example.com' },
      writable: true,
      configurable: true,
    });
    expect(isSecureContext()).toBe(false);
  });
});
