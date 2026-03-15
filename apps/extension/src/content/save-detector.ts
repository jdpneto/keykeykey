import type { LoginForm } from './form-detector';

const SAVE_BAR_CLASS = 'keykeykey-save-bar';

export function watchForSubmission(
  form: LoginForm,
  onSubmit: (username: string, password: string) => void,
): () => void {
  const formElement = form.formElement ?? form.passwordField.closest('form');

  const handler = (): void => {
    const username = form.usernameField?.value ?? '';
    const password = form.passwordField.value;
    if (password) {
      onSubmit(username, password);
    }
  };

  if (formElement) {
    formElement.addEventListener('submit', handler);
    return () => formElement.removeEventListener('submit', handler);
  }

  // Fallback: listen for Enter key on password field
  const keyHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handler();
    }
  };
  form.passwordField.addEventListener('keydown', keyHandler);
  return () => form.passwordField.removeEventListener('keydown', keyHandler);
}

export function removeSaveBar(): void {
  const bars = document.querySelectorAll(`.${SAVE_BAR_CLASS}`);
  bars.forEach((bar) => bar.remove());
}

export function showSaveBar(
  mode: 'save' | 'update',
  username: string,
  domain: string,
  onSave: () => void,
  onDismiss: () => void,
): void {
  // Remove any existing save bar
  removeSaveBar();

  const host = document.createElement('div');
  host.className = SAVE_BAR_CLASS;
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.right = '0';
  host.style.zIndex = '2147483647';

  // Use 'closed' mode to prevent page JavaScript from accessing the save bar
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = [
    ':host { font-family: system-ui, sans-serif; font-size: 14px; }',
    '.bar { display: flex; align-items: center; justify-content: center;',
    '  gap: 12px; padding: 12px 16px; background: #1a73e8;',
    '  color: white; box-shadow: 0 2px 8px rgba(0,0,0,0.2); }',
    '.message { flex: 1; text-align: center; }',
    'button { padding: 6px 16px; border-radius: 4px; border: none;',
    '  cursor: pointer; font-size: 14px; font-weight: 500; }',
    '.save-btn { background: white; color: #1a73e8; }',
    '.save-btn:hover { background: #e8f0fe; }',
    '.dismiss-btn { background: transparent; color: white; border: 1px solid white; }',
    '.dismiss-btn:hover { background: rgba(255,255,255,0.1); }',
  ].join('\n');
  shadow.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'alert');

  const message = document.createElement('span');
  message.className = 'message';
  if (mode === 'save') {
    message.textContent = `Save this password for ${domain}?`;
  } else {
    message.textContent = `Update password for ${username} on ${domain}?`;
  }
  bar.appendChild(message);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = mode === 'save' ? 'Save' : 'Update';
  saveBtn.addEventListener('click', (e: Event) => {
    if (!e.isTrusted) return;
    onSave();
    removeSaveBar();
  });
  bar.appendChild(saveBtn);

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'dismiss-btn';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', (e: Event) => {
    if (!e.isTrusted) return;
    onDismiss();
    removeSaveBar();
  });
  bar.appendChild(dismissBtn);

  shadow.appendChild(bar);
  document.body.appendChild(host);
}
