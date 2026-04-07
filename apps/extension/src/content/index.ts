import browser from 'webextension-polyfill';
import { detectLoginForms, observeFormChanges } from './form-detector.js';
import {
  injectAutofillIcon,
  removeAllAutofillIcons,
  fillCredential,
  isSecureContext,
} from './autofill-icon.js';
import { watchForSubmission, showSaveBar, removeSaveBar } from './save-detector.js';
import type { ContentPushMessage } from '../lib/messages.js';
import type { LoginForm } from './form-detector.js';

// Track cleanup functions for submission watchers so we can tear down on re-scan.
const submissionCleanups: (() => void)[] = [];

function handleForm(form: LoginForm): void {
  const hostname = window.location.hostname;

  // Ask background how many credentials match this tab's hostname.
  browser.runtime
    .sendMessage({ type: 'GET_CREDENTIALS_FOR_TAB', hostname })
    .then((response: unknown) => {
      const res = response as { count?: number; error?: string };
      if (res.error || !res.count || res.count === 0) return;

      const targetField = form.usernameField ?? form.passwordField;
      if (!targetField) return;

      const doInject = () => {
        injectAutofillIcon(
          targetField,
          async () => {
            const credRes = (await browser.runtime.sendMessage({
              type: 'GET_MATCHING_CREDENTIALS',
              hostname,
            })) as {
              credentials?: { id: string; name: string; username: string }[];
              error?: string;
            };
            return credRes.credentials ?? [];
          },
          async (id: string) => {
            const fillRes = (await browser.runtime.sendMessage({
              type: 'FILL_CREDENTIAL',
              id,
            })) as { username?: string; password?: string; error?: string };
            if (fillRes.error || !fillRes.username || !fillRes.password) return;
            fillCredential(form, fillRes.username, fillRes.password);
          },
        );
      };

      // Defer injection if field is not visible (e.g., multi-step login)
      if (targetField.offsetWidth > 0 && targetField.offsetHeight > 0) {
        doInject();
      } else {
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                observer.disconnect();
                doInject();
                break;
              }
            }
          },
          { threshold: 0.1 },
        );
        observer.observe(targetField);
      }
    });

  // Watch for form submission (save / update flow).
  const cleanup = watchForSubmission(form, (username: string, password: string) => {
    browser.runtime
      .sendMessage({
        type: 'CHECK_CREDENTIAL_EXISTS',
        hostname,
        username,
        password,
      })
      .then((response: unknown) => {
        const res = response as {
          exists?: boolean;
          changed?: boolean;
          credentialId?: string;
          error?: string;
        };
        if (res.error) return;

        if (!res.exists) {
          // Brand-new credential — offer to save.
          showSaveBar(
            'save',
            username,
            hostname,
            () => {
              browser.runtime.sendMessage({
                type: 'SAVE_CREDENTIAL',
                url: window.location.href,
                username,
                password,
                name: hostname,
              });
            },
            removeSaveBar,
          );
        } else if (res.changed && res.credentialId) {
          // Password changed — offer to update.
          showSaveBar(
            'update',
            username,
            hostname,
            () => {
              browser.runtime.sendMessage({
                type: 'UPDATE_CREDENTIAL',
                credentialId: res.credentialId!,
                password,
              });
            },
            removeSaveBar,
          );
        }
        // If exists and unchanged — do nothing.
      });
  });

  submissionCleanups.push(cleanup);
}

function teardown(): void {
  removeAllAutofillIcons();
  removeSaveBar();
  for (const cleanup of submissionCleanups) {
    cleanup();
  }
  submissionCleanups.length = 0;
}

function scanAndHandle(): void {
  teardown();
  const forms = detectLoginForms();
  for (const form of forms) {
    handleForm(form);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

if (!isSecureContext()) {
  // Only run on HTTPS pages (or localhost).
  console.debug('KeyKeyKey: skipping non-secure context');
} else {
  // Initial scan.
  scanAndHandle();

  // Dynamic detection for SPA-added forms.
  observeFormChanges((forms: LoginForm[]) => {
    teardown();
    for (const form of forms) {
      handleForm(form);
    }
  });

  // Listen for vault state push messages from background.
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as ContentPushMessage;
    switch (msg.type) {
      case 'VAULT_LOCKED':
        teardown();
        break;
      case 'VAULT_UNLOCKED':
      case 'VAULT_CHANGED':
        scanAndHandle();
        break;
      case 'FILL_FROM_POPUP': {
        const forms = detectLoginForms();
        if (forms.length > 0) {
          fillCredential(forms[0]!, msg.username, msg.password);
        } else {
          // Fallback: Google and other SPAs use dynamic forms that may not
          // have a visible password field yet. Find any focused or visible
          // input and fill what we can.
          const focused = document.activeElement;
          const passwordField = document.querySelector<HTMLInputElement>(
            'input[type="password"]:not([hidden])',
          );
          const emailField = document.querySelector<HTMLInputElement>(
            'input[type="email"]:not([hidden]), input[autocomplete="username"]:not([hidden])',
          );
          const setter =
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) {
            if (passwordField) {
              setter.call(passwordField, msg.password);
              passwordField.dispatchEvent(new Event('input', { bubbles: true }));
              passwordField.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (emailField) {
              setter.call(emailField, msg.username);
              emailField.dispatchEvent(new Event('input', { bubbles: true }));
              emailField.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (
              focused instanceof HTMLInputElement &&
              focused !== passwordField &&
              (focused.type === 'text' || focused.type === 'email' || focused.type === 'tel')
            ) {
              // If no email field found, fill the focused input as username
              setter.call(focused, msg.username);
              focused.dispatchEvent(new Event('input', { bubbles: true }));
              focused.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        break;
      }
    }
  });
}
