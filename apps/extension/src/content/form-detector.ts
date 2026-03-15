export interface LoginForm {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement;
  formElement: HTMLFormElement | null;
}

const USERNAME_PATTERN = /user|email|login|account|name/i;

function findUsernameField(passwordField: HTMLInputElement): HTMLInputElement | null {
  const form = passwordField.closest('form');
  const root: ParentNode = form ?? passwordField.getRootNode() as ParentNode;

  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input'));

  // Priority 1: autocomplete="username" or autocomplete="email"
  for (const input of inputs) {
    const ac = input.getAttribute('autocomplete');
    if (ac === 'username' || ac === 'email') {
      return input;
    }
  }

  // Priority 2: type email/text/tel with name/id matching pattern
  for (const input of inputs) {
    const type = (input.type || 'text').toLowerCase();
    if (type === 'email' || type === 'text' || type === 'tel') {
      const name = input.name || '';
      const id = input.id || '';
      if (USERNAME_PATTERN.test(name) || USERNAME_PATTERN.test(id)) {
        return input;
      }
    }
  }

  return null;
}

export function detectLoginForms(root: ParentNode = document): LoginForm[] {
  const passwordFields = Array.from(
    root.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete="current-password"]',
    ),
  );

  const seen = new Set<HTMLInputElement>();
  const forms: LoginForm[] = [];

  for (const passwordField of passwordFields) {
    if (seen.has(passwordField)) continue;
    seen.add(passwordField);

    forms.push({
      usernameField: findUsernameField(passwordField),
      passwordField,
      formElement: passwordField.closest('form'),
    });
  }

  return forms;
}

export function observeFormChanges(callback: (forms: LoginForm[]) => void): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = null;
      callback(detectLoginForms());
    }, 100);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    observer.disconnect();
  };
}
