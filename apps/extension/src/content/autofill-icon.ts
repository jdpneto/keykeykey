import type { LoginForm } from './form-detector';

const AUTOFILL_HOST_CLASS = 'keykeykey-autofill-host';

interface Credential {
  id: string;
  name: string;
  username: string;
}

export function isSecureContext(): boolean {
  return location.protocol === 'https:' || location.hostname === 'localhost';
}

export function fillCredential(form: LoginForm, username: string, password: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;

  if (form.usernameField) {
    setter.call(form.usernameField, username);
    form.usernameField.dispatchEvent(new Event('input', { bubbles: true }));
    form.usernameField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  setter.call(form.passwordField, password);
  form.passwordField.dispatchEvent(new Event('input', { bubbles: true }));
  form.passwordField.dispatchEvent(new Event('change', { bubbles: true }));
}

export function removeAllAutofillIcons(): void {
  const hosts = document.querySelectorAll(`.${AUTOFILL_HOST_CLASS}`);
  hosts.forEach((host) => host.remove());
}

export function injectAutofillIcon(
  field: HTMLInputElement,
  onGetCredentials: () => Promise<Credential[]>,
  onSelectCredential: (id: string) => Promise<void>,
): void {
  const host = document.createElement('div');
  host.className = AUTOFILL_HOST_CLASS;
  host.style.position = 'absolute';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'open' });

  // Styles
  const style = document.createElement('style');
  style.textContent = [
    ':host { font-family: system-ui, sans-serif; font-size: 14px; }',
    '.icon { width: 24px; height: 24px; cursor: pointer; display: flex;',
    '  align-items: center; justify-content: center; border-radius: 4px;',
    '  background: #f0f0f0; border: 1px solid #ccc; user-select: none; }',
    '.icon:hover { background: #e0e0e0; }',
    '.dropdown { position: absolute; top: 28px; left: 0; min-width: 200px;',
    '  background: white; border: 1px solid #ccc; border-radius: 6px;',
    '  box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none;',
    '  max-height: 200px; overflow-y: auto; }',
    '.dropdown.open { display: block; }',
    '.item { padding: 8px 12px; cursor: pointer; outline: none; }',
    '.item:hover, .item.active { background: #e8f0fe; }',
    '.item-name { font-weight: 500; }',
    '.item-username { font-size: 12px; color: #666; }',
    '.empty { padding: 8px 12px; color: #999; }',
  ].join('\n');
  shadow.appendChild(style);

  // Icon button
  const icon = document.createElement('div');
  icon.className = 'icon';
  icon.setAttribute('role', 'button');
  icon.setAttribute('aria-label', 'Autofill credentials');
  icon.setAttribute('tabindex', '0');
  icon.textContent = '\uD83D\uDD11';
  shadow.appendChild(icon);

  // Dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'dropdown';
  dropdown.setAttribute('role', 'listbox');
  dropdown.setAttribute('aria-label', 'Credential list');
  shadow.appendChild(dropdown);

  let activeIndex = -1;
  let items: HTMLElement[] = [];

  function setActiveItem(index: number): void {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('active');
        item.setAttribute('aria-selected', 'true');
      } else {
        item.classList.remove('active');
        item.removeAttribute('aria-selected');
      }
    });
    activeIndex = index;
  }

  function closeDropdown(): void {
    dropdown.classList.remove('open');
    activeIndex = -1;
    items = [];
  }

  async function openDropdown(): Promise<void> {
    // Clear previous items
    while (dropdown.firstChild) {
      dropdown.removeChild(dropdown.firstChild);
    }

    const credentials = await onGetCredentials();
    items = [];
    activeIndex = -1;

    if (credentials.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No credentials found';
      dropdown.appendChild(empty);
    } else {
      for (const cred of credentials) {
        const item = document.createElement('div');
        item.className = 'item';
        item.setAttribute('role', 'option');
        item.setAttribute('tabindex', '-1');

        const nameEl = document.createElement('div');
        nameEl.className = 'item-name';
        nameEl.textContent = cred.name;
        item.appendChild(nameEl);

        const usernameEl = document.createElement('div');
        usernameEl.className = 'item-username';
        usernameEl.textContent = cred.username;
        item.appendChild(usernameEl);

        item.addEventListener('click', () => {
          onSelectCredential(cred.id);
          closeDropdown();
        });

        dropdown.appendChild(item);
        items.push(item);
      }
    }

    dropdown.classList.add('open');
  }

  icon.addEventListener('click', () => {
    if (dropdown.classList.contains('open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  icon.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (dropdown.classList.contains('open')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    }
  });

  shadow.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (!dropdown.classList.contains('open')) return;

    if (ke.key === 'ArrowDown') {
      ke.preventDefault();
      const next = activeIndex < items.length - 1 ? activeIndex + 1 : 0;
      setActiveItem(next);
    } else if (ke.key === 'ArrowUp') {
      ke.preventDefault();
      const prev = activeIndex > 0 ? activeIndex - 1 : items.length - 1;
      setActiveItem(prev);
    } else if (ke.key === 'Enter' && activeIndex >= 0) {
      ke.preventDefault();
      items[activeIndex].click();
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      closeDropdown();
    }
  });

  // Position the host near the field
  const parent = field.offsetParent ?? document.body;
  parent.appendChild(host);

  const rect = field.getBoundingClientRect();
  const parentRect = (parent as HTMLElement).getBoundingClientRect();
  host.style.left = `${rect.right - parentRect.left - 28}px`;
  host.style.top = `${rect.top - parentRect.top + (rect.height - 24) / 2}px`;
}
