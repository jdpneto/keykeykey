import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  injectAutofillIcon,
  removeAllAutofillIcons,
  fillCredential,
  isSecureContext,
} from './autofill-icon';
import type { LoginForm } from './form-detector';

/**
 * Dispatch a click event that passes isTrusted checks in jsdom.
 *
 * jsdom resets isTrusted to false inside dispatchEvent (per spec), and the
 * property is defined as a non-configurable getter on every Event instance.
 * We work around this by marking the event and having a patched
 * addEventListener (see beforeEach) wrap handlers with a Proxy that
 * intercepts the isTrusted read.
 */
function trustedClick(element: Element): void {
  const event = new MouseEvent('click', { bubbles: true });
  (event as unknown as { _forceTrusted: boolean })._forceTrusted = true;
  element.dispatchEvent(event);
}

/**
 * Get the shadow root from a host element that uses closed mode.
 * We monkey-patch attachShadow so the test can retain the reference.
 */
function getClosedShadowRoot(host: Element): ShadowRoot {
  return (host as unknown as { __closedShadowRoot: ShadowRoot }).__closedShadowRoot;
}

const origAttachShadow = Element.prototype.attachShadow;
const origAddEventListener = EventTarget.prototype.addEventListener;
const origRemoveEventListener = EventTarget.prototype.removeEventListener;

/** Map from original listener to its wrapped version for removeEventListener compat. */
const listenerMap = new WeakMap<
  EventListenerOrEventListenerObject,
  EventListenerOrEventListenerObject
>();

beforeEach(() => {
  // Patch attachShadow to stash the closed shadow root for test access.
  Element.prototype.attachShadow = function (init: ShadowRootInit): ShadowRoot {
    const shadow = origAttachShadow.call(this, init);
    (this as unknown as { __closedShadowRoot: ShadowRoot }).__closedShadowRoot = shadow;
    return shadow;
  };

  // Patch addEventListener so handlers receive a Proxy with isTrusted: true
  // when the dispatched event has the _forceTrusted flag.
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (!listener) return origAddEventListener.call(this, type, listener, options);

    const wrapped: EventListener = function (this: unknown, e: Event) {
      const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener);
      if ((e as unknown as { _forceTrusted?: boolean })._forceTrusted) {
        const proxy = new Proxy(e, {
          get(target, prop, receiver) {
            if (prop === 'isTrusted') return true;
            const val = Reflect.get(target, prop, receiver);
            return typeof val === 'function' ? val.bind(target) : val;
          },
        });
        return fn.call(this, proxy);
      }
      return fn.call(this, e);
    };
    listenerMap.set(listener, wrapped);
    return origAddEventListener.call(this, type, wrapped, options);
  };

  // Patch removeEventListener to look up the wrapped handler.
  EventTarget.prototype.removeEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    const actual = listener ? listenerMap.get(listener) ?? listener : listener;
    return origRemoveEventListener.call(this, type, actual, options);
  };
});

afterEach(() => {
  removeAllAutofillIcons();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  Element.prototype.attachShadow = origAttachShadow;
  EventTarget.prototype.addEventListener = origAddEventListener;
  EventTarget.prototype.removeEventListener = origRemoveEventListener;
});

describe('injectAutofillIcon', () => {
  it('creates a shadow DOM host element near the field', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host');
    expect(host).not.toBeNull();
    expect(getClosedShadowRoot(host!)).not.toBeNull();
  });

  it('renders icon with correct ARIA attributes', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const shadow = getClosedShadowRoot(host);
    const icon = shadow.querySelector('[role="button"]');
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute('aria-label')).toBe('Autofill credentials');
  });

  it('renders dropdown with role="listbox"', () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    injectAutofillIcon(field, vi.fn().mockResolvedValue([]), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const shadow = getClosedShadowRoot(host);
    const dropdown = shadow.querySelector('[role="listbox"]');
    expect(dropdown).not.toBeNull();
  });

  it('opens dropdown on icon click and displays credentials', async () => {
    const field = document.createElement('input');
    field.type = 'password';
    document.body.appendChild(field);

    const creds = [{ id: '1', name: 'Test', username: 'user@test.com' }];
    injectAutofillIcon(field, vi.fn().mockResolvedValue(creds), vi.fn());

    const host = document.querySelector('.keykeykey-autofill-host')!;
    const shadow = getClosedShadowRoot(host);
    const icon = shadow.querySelector('[role="button"]') as HTMLElement;
    trustedClick(icon);

    // Wait for async onGetCredentials
    await vi.waitFor(() => {
      const items = shadow.querySelectorAll('[role="option"]');
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
    const shadow = getClosedShadowRoot(host);
    const icon = shadow.querySelector('[role="button"]') as HTMLElement;
    trustedClick(icon);

    await vi.waitFor(() => {
      const items = shadow.querySelectorAll('[role="option"]');
      expect(items).toHaveLength(1);
    });

    const item = shadow.querySelector('[role="option"]') as HTMLElement;
    trustedClick(item);
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
