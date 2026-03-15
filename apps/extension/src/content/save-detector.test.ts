import { describe, it, expect, vi, afterEach } from 'vitest';
import { watchForSubmission, showSaveBar, removeSaveBar } from './save-detector';
import type { LoginForm } from './form-detector';

afterEach(() => {
  removeSaveBar();
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
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
    expect(host!.shadowRoot).not.toBeNull();

    const message = host!.shadowRoot!.querySelector('.message');
    expect(message!.textContent).toBe('Save this password for example.com?');
  });

  it('creates a save bar in update mode with correct message', () => {
    showSaveBar('update', 'admin', 'site.com', vi.fn(), vi.fn());

    const host = document.querySelector('.keykeykey-save-bar')!;
    const message = host.shadowRoot!.querySelector('.message');
    expect(message!.textContent).toBe('Update password for admin on site.com?');
  });

  it('calls onSave when save button is clicked', () => {
    const onSave = vi.fn();
    showSaveBar('save', 'user', 'example.com', onSave, vi.fn());

    const host = document.querySelector('.keykeykey-save-bar')!;
    const saveBtn = host.shadowRoot!.querySelector('.save-btn') as HTMLElement;
    saveBtn.click();

    expect(onSave).toHaveBeenCalled();
    // Bar should be removed after clicking
    expect(document.querySelector('.keykeykey-save-bar')).toBeNull();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    showSaveBar('save', 'user', 'example.com', vi.fn(), onDismiss);

    const host = document.querySelector('.keykeykey-save-bar')!;
    const dismissBtn = host.shadowRoot!.querySelector('.dismiss-btn') as HTMLElement;
    dismissBtn.click();

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
