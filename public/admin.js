const dialog = document.querySelector('#admin');
const open = document.querySelector('#admin-open');
const login = document.querySelector('#admin-login');
const settings = document.querySelector('#admin-settings');
const keyField = document.querySelector('#admin-key');
const message = document.querySelector('#admin-message');
let key = '';

function showLogin() {
  key = '';
  keyField.value = '';
  open.textContent = 'Log in';
  login.hidden = false;
  settings.hidden = true;
}

async function requestSettings(token, rules) {
  const response = await fetch('/api/admin/settings', {
    method: rules ? 'PUT' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(rules && { 'Content-Type': 'application/json' }) },
    body: rules ? JSON.stringify(rules) : undefined,
    cache: 'no-store',
    redirect: 'error'
  });
  if (response.status === 401 || response.status === 503) showLogin();
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load settings.');
  return data;
}

function fill(rules) {
  settings.elements.pixels.value = rules.pixels;
  settings.elements.seconds.value = rules.seconds;
  settings.elements.shared.checked = rules.mode === 'ip';
}

open.onclick = () => {
  message.textContent = '';
  dialog.showModal();
  if (!key) keyField.focus();
};
dialog.querySelector('#admin-close').onclick = () => dialog.close();
dialog.onclose = () => { keyField.value = ''; };
dialog.querySelector('#admin-logout').onclick = () => {
  showLogin();
  dialog.close();
};

// Open tabs receive the same saved rules as the board, including other admins' edits.
window.addEventListener('canvas-rules', event => {
  if (key) fill(event.detail);
});

dialog.addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  if (button.disabled) return;
  button.disabled = true;
  message.textContent = '';
  try {
    if (event.target === login) {
      const token = keyField.value.trim();
      const rules = await requestSettings(token);
      key = token;
      keyField.value = '';
      fill(rules);
      login.hidden = true;
      settings.hidden = false;
      open.textContent = 'Settings';
      settings.elements.pixels.focus();
    } else {
      fill(await requestSettings(key, {
        pixels: settings.elements.pixels.valueAsNumber,
        seconds: settings.elements.seconds.valueAsNumber,
        mode: settings.elements.shared.checked ? 'ip' : 'browser'
      }));
      message.textContent = 'Settings saved.';
    }
  } catch (error) {
    message.textContent = error instanceof TypeError || error instanceof SyntaxError
      ? 'Could not reach Canvas. Try again.' : error.message;
  } finally {
    button.disabled = false;
  }
});
