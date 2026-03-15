import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { watchForSubmission, showSaveBar, removeSaveBar } from './save-detector';
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
    const actual = listener ? (listenerMap.get(listener) ?? listener) : listener;
    return origRemoveEventListener.call(this, type, actual, options);
  };
});

afterEach(() => {
  removeSaveBar();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  Element.prototype.attachShadow = origAttachShadow;
  EventTarget.prototype.addEventListener = origAddEventListener;
  EventTarget.prototype.removeEventListener = origRemoveEventListener;
});

describe('watchForSubmission', () => {
  it('triggers callback with credentials on form submit', () => {
    const form = document.createElement('form');
    const username = document.createElement('input');
    username.type = 'text';
    username.value = 'testuser';
    const password = document.createElement('input');
    password.type = 'password';
    password.value = 'secret123';
    form.appendChild(username);
    form.appendChild(password);
    document.body.appendChild(form);

    const loginForm: LoginForm = {
      usernameField: username,
      passwordField: password,
      formElement: form,
    };

    const onSubmit = vi.fn();
    const cleanup = watchForSubmission(loginForm, onSubmit);

    form.dispatchEvent(new Event('submit'));

    expect(onSubmit).toHaveBeenCalledWith('testuser', 'secret123');

    cleanup();
  });

  it('does not trigger callback after cleanup', () => {
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    password.value = 'pass';
    form.appendChild(password);
    document.body.appendChild(form);

    const loginForm: LoginForm = {
      usernameField: null,
      passwordField: password,
      formElement: form,
    };

    const onSubmit = vi.fn();
    const cleanup = watchForSubmission(loginForm, onSubmit);
    cleanup();

    form.dispatchEvent(new Event('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not trigger callback when password is empty', () => {
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    password.value = '';
    form.appendChild(password);
    document.body.appendChild(form);

    const loginForm: LoginForm = {
      usernameField: null,
      passwordField: password,
      formElement: form,
    };

    const onSubmit = vi.fn();
    watchForSubmission(loginForm, onSubmit);

    form.dispatchEvent(new Event('submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('passes empty string as username when usernameField is null', () => {
    const form = document.createElement('form');
    const password = document.createElement('input');
    password.type = 'password';
    password.value = 'mypass';
    form.appendChild(password);
    document.body.appendChild(form);

    const loginForm: LoginForm = {
      usernameField: null,
      passwordField: password,
      formElement: form,
    };

    const onSubmit = vi.fn();
    watchForSubmission(loginForm, onSubmit);

    form.dispatchEvent(new Event('submit'));
    expect(onSubmit).toHaveBeenCalledWith('', 'mypass');
  });
});

describe('showSaveBar', () => {
  it('creates a save bar with shadow DOM in save mode', () => {
    const onSave = vi.fn();
    const onDismiss = vi.fn();
    showSaveBar('save', 'user', 'example.com', onSave, onDismiss);

    const host = document.querySelector('.keykeykey-save-bar');
    expect(host).not.toBeNull();
    const shadow = getClosedShadowRoot(host!);
    expect(shadow).not.toBeNull();

    const message = shadow.querySelector('.message');
    expect(message!.textContent).toBe('Save this password for example.com?');
  });

  it('creates a save bar in update mode with correct message', () => {
    showSaveBar('update', 'admin', 'site.com', vi.fn(), vi.fn());

    const host = document.querySelector('.keykeykey-save-bar')!;
    const shadow = getClosedShadowRoot(host);
    const message = shadow.querySelector('.message');
    expect(message!.textContent).toBe('Update password for admin on site.com?');
  });

  it('calls onSave when save button is clicked', () => {
    const onSave = vi.fn();
    showSaveBar('save', 'user', 'example.com', onSave, vi.fn());

    const host = document.querySelector('.keykeykey-save-bar')!;
    const shadow = getClosedShadowRoot(host);
    const saveBtn = shadow.querySelector('.save-btn') as HTMLElement;
    trustedClick(saveBtn);

    expect(onSave).toHaveBeenCalled();
    // Bar should be removed after clicking
    expect(document.querySelector('.keykeykey-save-bar')).toBeNull();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    showSaveBar('save', 'user', 'example.com', vi.fn(), onDismiss);

    const host = document.querySelector('.keykeykey-save-bar')!;
    const shadow = getClosedShadowRoot(host);
    const dismissBtn = shadow.querySelector('.dismiss-btn') as HTMLElement;
    trustedClick(dismissBtn);

    expect(onDismiss).toHaveBeenCalled();
    expect(document.querySelector('.keykeykey-save-bar')).toBeNull();
  });
});

describe('removeSaveBar', () => {
  it('removes the save bar from the DOM', () => {
    showSaveBar('save', 'user', 'example.com', vi.fn(), vi.fn());
    expect(document.querySelector('.keykeykey-save-bar')).not.toBeNull();

    removeSaveBar();
    expect(document.querySelector('.keykeykey-save-bar')).toBeNull();
  });
});
