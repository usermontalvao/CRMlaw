// Guarda da sessão. Só o service worker importa este módulo — o popup nunca
// vê token nenhum.
//
// Onde cada coisa fica, e por quê:
//
//   access token  → chrome.storage.session  (memória; some ao fechar o Chrome)
//   refresh token → chrome.storage.local    (precisa sobreviver ao reinício,
//                                            senão não existe login persistente)
//   senha         → LUGAR NENHUM. Ela existe só dentro da chamada de login.
//
// `chrome.storage.sync` está fora de questão: sincronizar segredo pela conta
// Google seria espalhá-lo por todo dispositivo logado. E `localStorage` não é
// usado em ponto algum da extensão.

const LOCAL_KEY = 'vault.refresh';
const SESSION_KEY = 'vault.access';
const DEVICE_KEY = 'vault.device';
const USER_KEY = 'vault.user';

export async function getDeviceId() {
  const stored = await chrome.storage.local.get(DEVICE_KEY);
  if (stored[DEVICE_KEY]) return stored[DEVICE_KEY];

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const deviceId = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  await chrome.storage.local.set({ [DEVICE_KEY]: deviceId });
  return deviceId;
}

/** Nome amigável do dispositivo, para a lista de sessões do CRM. */
export function deviceName() {
  const ua = navigator.userAgent;
  const os = /Mac/i.test(ua) ? 'Mac' : /Windows/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Desconhecido';
  return `Chrome — ${os}`;
}

export async function readAccess() {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] ?? null;
}

export async function readRefresh() {
  const stored = await chrome.storage.local.get(LOCAL_KEY);
  return stored[LOCAL_KEY] ?? null;
}

export async function readUser() {
  const stored = await chrome.storage.session.get(USER_KEY);
  if (stored[USER_KEY]) return stored[USER_KEY];
  const persisted = await chrome.storage.local.get(USER_KEY);
  return persisted[USER_KEY] ?? null;
}

export async function saveTokens(payload) {
  const now = Date.now();
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      token: payload.access_token,
      expiresAt: now + (payload.access_expires_in ?? 900) * 1000,
      sessionId: payload.session_id ?? null,
    },
  });
  await chrome.storage.local.set({
    [LOCAL_KEY]: {
      token: payload.refresh_token,
      expiresAt: now + (payload.refresh_expires_in ?? 2592000) * 1000,
    },
  });
  if (payload.user) {
    // O perfil é rótulo de tela, não credencial: pode persistir para o popup
    // abrir já com o nome certo.
    await chrome.storage.session.set({ [USER_KEY]: payload.user });
    await chrome.storage.local.set({ [USER_KEY]: payload.user });
  }
}

export async function clearSession() {
  await chrome.storage.session.remove([SESSION_KEY, USER_KEY]);
  await chrome.storage.local.remove([LOCAL_KEY, USER_KEY]);
}
