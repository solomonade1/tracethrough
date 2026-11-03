import '../renderer/src/styles.css';
import { createWebApi } from './client';

const TOKEN_KEY = 'tracelens-token';

/** The launch link carries the token in the fragment; keep it for reloads, then hide it from the address bar. */
function readToken(): string | undefined {
  const fromLink = new URLSearchParams(location.hash.slice(1)).get('token') ?? undefined;
  try {
    if (fromLink) sessionStorage.setItem(TOKEN_KEY, fromLink);
    else return sessionStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    // Storage blocked: the token still works until the tab reloads.
  }
  if (fromLink) history.replaceState(null, '', location.pathname);
  return fromLink;
}

function showMessage(text: string) {
  const main = document.createElement('main');
  main.className = 'home';
  const card = document.createElement('section');
  card.className = 'card';
  const title = document.createElement('h2');
  title.textContent = 'TraceLens';
  const body = document.createElement('p');
  body.className = 'muted';
  body.setAttribute('role', 'alert');
  body.textContent = text;
  card.append(title, body);
  main.append(card);
  document.body.replaceChildren(main);
}

const token = readToken();
if (token) {
  window.tracelens = createWebApi(token, showMessage);
  void import('../renderer/src/main');
} else {
  showMessage('Open TraceLens with the link printed in the terminal where you started it (it includes an access token).');
}
