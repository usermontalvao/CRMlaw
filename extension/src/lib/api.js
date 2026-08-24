// Cliente HTTP do cofre. Vive só no service worker.
//
// Regras que este arquivo carrega sozinho:
//   • o token nunca sai daqui para o popup;
//   • 401 tenta UMA renovação e repete a chamada — duas seriam laço;
//   • nada é registrado em console: erro de rede pode carregar corpo inteiro.

import { VAULT_BASE_URL, ACCESS_REFRESH_MARGIN_SECONDS } from './config.js';
import { clearSession, deviceName, getDeviceId, readAccess, readRefresh, saveTokens } from './session.js';

export class VaultError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let renovacaoEmCurso = null;

async function rawFetch(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Vault-Session'] = token;

  let response;
  try {
    response = await fetch(`${VAULT_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // A extensão não usa cookie em nenhum momento — não há CSRF a defender
      // porque não há credencial ambiente.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (_) {
    throw new VaultError(0, 'Sem conexão com o cofre. Verifique a internet.');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    throw new VaultError(response.status, payload?.error ?? 'Não foi possível concluir a operação.');
  }
  return payload;
}

async function accessToken() {
  const access = await readAccess();
  if (access && access.expiresAt - Date.now() > ACCESS_REFRESH_MARGIN_SECONDS * 1000) {
    return access.token;
  }
  return refreshAccess();
}

export async function refreshAccess() {
  // Uma renovação por vez: dois pedidos paralelos girariam o refresh duas
  // vezes e o servidor trataria o segundo como reuso — derrubando a sessão.
  if (renovacaoEmCurso) return renovacaoEmCurso;

  renovacaoEmCurso = (async () => {
    const refresh = await readRefresh();
    if (!refresh || refresh.expiresAt <= Date.now()) {
      await clearSession();
      throw new VaultError(401, 'Sessão expirada. Entre novamente.');
    }
    try {
      const payload = await rawFetch('/auth/refresh', { method: 'POST', body: { refresh_token: refresh.token } });
      await saveTokens(payload);
      return payload.access_token;
    } catch (error) {
      if (error instanceof VaultError && (error.status === 401 || error.status === 403)) {
        await clearSession();
      }
      throw error;
    } finally {
      renovacaoEmCurso = null;
    }
  })();

  return renovacaoEmCurso;
}

export async function api(path, options = {}) {
  const token = await accessToken();
  try {
    return await rawFetch(path, { ...options, token });
  } catch (error) {
    if (error instanceof VaultError && error.status === 401) {
      const renovado = await refreshAccess();
      return rawFetch(path, { ...options, token: renovado });
    }
    throw error;
  }
}

export async function login(email, password, pin) {
  const payload = await rawFetch('/auth/login', {
    method: 'POST',
    body: {
      email,
      password,
      // Vazio na primeira etapa: o servidor responde 428 quando a senha passou
      // e só falta o PIN, e é isso que move a tela para a segunda etapa.
      pin,
      device_id: await getDeviceId(),
      device_name: deviceName(),
    },
  });
  // Senha e PIN morrem aqui: nada deles é guardado, nem em variável de módulo.
  await saveTokens(payload);
  return payload.user;
}

export async function logout() {
  try {
    const token = await accessToken();
    await rawFetch('/auth/logout', { method: 'POST', token });
  } catch (_) {
    // Mesmo se o servidor não responder, a sessão local vai embora.
  }
  await clearSession();
}
