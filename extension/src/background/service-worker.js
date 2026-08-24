// Service worker — o único lugar da extensão que toca em token e em rede.
//
// O popup conversa por mensagem e recebe sempre dados já mastigados. Isso não
// é só arrumação: se o popup nunca tem o token, inspecionar o DevTools do
// popup não entrega sessão nenhuma.
//
// Não há content script, não há leitura de página, não há injeção em aba.

import { api, login, logout, refreshAccess, VaultError } from '../lib/api.js';
import { clearSession, readAccess, readRefresh, readUser } from '../lib/session.js';
import { ACCESS_REFRESH_MARGIN_SECONDS, KEEPALIVE_ALARM, KEEPALIVE_MINUTES } from '../lib/config.js';
import { preencherNaPagina } from '../lib/preencher.js';

// ── roteador de mensagens ───────────────────────────────────────────────────

const acoes = {
  async estado() {
    const refresh = await readRefresh();
    if (!refresh || refresh.expiresAt <= Date.now()) {
      return { autenticado: false, usuario: null };
    }
    return { autenticado: true, usuario: await readUser() };
  },

  async entrar({ email, senha, pin }) {
    const usuario = await login(String(email ?? '').trim(), String(senha ?? ''), String(pin ?? ''));
    return { usuario };
  },

  async sair() {
    await logout();
    return { ok: true };
  },

  async perfil() {
    return api('/auth/me');
  },

  async listar() {
    return api('/credentials');
  },

  async codigos(payload) {
    return api('/codes', {
      method: 'POST',
      body: payload?.ids ? { credential_ids: payload.ids } : {},
    });
  },

  async detalhe({ id }) {
    return api(`/credentials/${encodeURIComponent(id)}`);
  },

  async criar({ dados }) {
    return api('/credentials', { method: 'POST', body: dados });
  },

  async atualizar({ id, dados }) {
    return api(`/credentials/${encodeURIComponent(id)}`, { method: 'PATCH', body: dados });
  },

  async excluir({ id, motivo }) {
    return api(`/credentials/${encodeURIComponent(id)}`, { method: 'DELETE', body: { reason: motivo } });
  },

  async favoritar({ id, favorito }) {
    return api(`/credentials/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: { favorite: favorito } });
  },

  async permissoes({ id }) {
    return api(`/credentials/${encodeURIComponent(id)}/permissions`);
  },

  async compartilhar({ id, userId, permissao, stepUpToken }) {
    return api(`/credentials/${encodeURIComponent(id)}/permissions`, {
      method: 'POST',
      body: { user_id: userId, permission: permissao, step_up_token: stepUpToken },
    });
  },

  async revogar({ id, userId }) {
    return api(`/credentials/${encodeURIComponent(id)}/permissions/${encodeURIComponent(userId)}`, { method: 'DELETE' });
  },

  async buscarUsuarios({ termo }) {
    return api(`/users/search?q=${encodeURIComponent(termo)}`);
  },

  async analisarImportacao({ payload, itens }) {
    return api('/import', { method: 'POST', body: { mode: 'analyze', payload, items: itens } });
  },

  /**
   * Ponte da janela da câmera para o popup.
   *
   * A janela do scanner não pode simplesmente "abrir o popup" — popup de
   * extensão só abre por gesto do usuário no ícone. Então o QR lido é
   * analisado aqui e o resultado fica guardado em `chrome.storage.session`,
   * que vive na memória e morre com o navegador. O popup, ao abrir, encontra
   * a análise pronta e pula direto para a tela de escolha.
   *
   * Fica guardada a ANÁLISE (nome, emissor, se já existe) — nunca o segredo,
   * que não volta do servidor, e nunca o payload bruto do QR.
   */
  async qrDaCamera({ payload }) {
    const analise = await api('/import', { method: 'POST', body: { mode: 'analyze', payload } });
    await chrome.storage.session.set({
      'vault.importacao': { payload, itens: analise.items, pulados: analise.skipped, em: Date.now() },
    });
    return { total: analise.items?.length ?? 0 };
  },

  /** O popup consome uma vez e limpa: importação pendente não pode ficar rondando. */
  async importacaoPendente() {
    const guardado = await chrome.storage.session.get('vault.importacao');
    const pendente = guardado['vault.importacao'] ?? null;
    if (pendente) await chrome.storage.session.remove('vault.importacao');
    // Análise velha não serve: o cofre pode ter mudado desde então.
    if (!pendente || Date.now() - pendente.em > 5 * 60 * 1000) return null;
    return pendente;
  },

  /**
   * Escreve o código no campo da página aberta.
   *
   * O código NÃO vem do popup: ele é pedido ao cofre aqui, agora. Assim o que
   * entra na página é um código recém-gerado e válido, e o popup continua sem
   * ter poder nenhum sobre a aba.
   *
   * `activeTab` só vale para a aba atual e só por causa do clique que
   * disparou isto. A extensão não enxerga página nenhuma fora deste instante.
   */
  async preencher({ id }) {
    const resposta = await api('/codes', { method: 'POST', body: { credential_ids: [id] } });
    const codigo = resposta?.codes?.[0]?.code;
    if (!codigo) throw new VaultError(404, 'Não foi possível gerar o código agora.');

    const [aba] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!aba?.id) throw new VaultError(400, 'Nenhuma aba aberta para preencher.');

    let saida;
    try {
      [saida] = await chrome.scripting.executeScript({
        target: { tabId: aba.id },
        func: preencherNaPagina,
        args: [codigo],
      });
    } catch (_) {
      // Páginas internas do Chrome, a loja de extensões e PDFs recusam injeção.
      throw new VaultError(400, 'Esta página não permite preenchimento. Use "Copiar".');
    }

    const r = saida?.result;
    if (!r?.ok) throw new VaultError(404, 'Não encontrei o campo do código nesta página. Use "Copiar".');
    return { modo: r.modo };
  },

  /** Abre a janela da câmera. Não precisa da permissão `tabs`. */
  async abrirCamera() {
    await chrome.windows.create({
      url: chrome.runtime.getURL('src/scan/scan.html'),
      type: 'popup',
      width: 460,
      height: 620,
    });
    return { ok: true };
  },

  async importar({ payload, itens, selecionados }) {
    return api('/import', { method: 'POST', body: { mode: 'commit', payload, items: itens, selected: selecionados } });
  },

  async confirmarIdentidade({ senha }) {
    return api('/auth/step-up', { method: 'POST', body: { password: String(senha ?? '') } });
  },

  async exportar({ id, motivo, stepUpToken }) {
    return api(`/credentials/${encodeURIComponent(id)}/export`, {
      method: 'POST',
      body: { reason: motivo, step_up_token: stepUpToken },
    });
  },

  async transferir({ id, novoDono, stepUpToken, motivo }) {
    return api(`/credentials/${encodeURIComponent(id)}/transfer`, {
      method: 'POST',
      body: { new_owner_user_id: novoDono, step_up_token: stepUpToken, reason: motivo },
    });
  },

  async dispositivos() {
    return api('/auth/sessions');
  },

  async revogarDispositivo({ id }) {
    return api(`/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

chrome.runtime.onMessage.addListener((mensagem, _sender, responder) => {
  const acao = acoes[mensagem?.acao];
  if (!acao) {
    // Quase sempre isto é a extensão recarregada pela metade: o popup novo
    // conversando com um service worker antigo, ainda em memória.
    responder({ erro: 'Esta versão da extensão está desatualizada. Recarregue-a em chrome://extensions.' });
    return false;
  }

  acao(mensagem.dados ?? {})
    .then((resultado) => responder({ ok: true, resultado }))
    .catch(async (erro) => {
      const status = erro instanceof VaultError ? erro.status : 500;
      if (status === 401 || status === 403) {
        const refresh = await readRefresh();
        if (!refresh) await clearSession();
      }
      // A mensagem que sobe é a que o servidor escreveu para humano — nunca o
      // detalhe técnico, que já ficou no servidor.
      responder({ erro: erro?.message ?? 'Não foi possível concluir a operação.', status });
    });

  return true; // resposta assíncrona
});

// ── manutenção da sessão ────────────────────────────────────────────────────
//
// O service worker do MV3 é desligado quando ocioso. O alarme o acorda de vez
// em quando só para renovar o access antes de vencer, para o popup abrir
// instantâneo em vez de gastar uma ida ao servidor.

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarme) => {
  if (alarme.name !== KEEPALIVE_ALARM) return;

  const refresh = await readRefresh();
  if (!refresh || refresh.expiresAt <= Date.now()) return;

  // Só renova se o access estiver REALMENTE perto de vencer.
  //
  // Antes este alarme rotacionava a cada 10 minutos, sempre — umas 144 vezes
  // por dia, quase todas desnecessárias. E cada rotação é uma chance de a
  // resposta se perder e a extensão ficar com o token velho. Era isso que
  // deslogava o usuário "sozinho" depois de algumas horas.
  //
  // Renovar sob demanda já é feito por `accessToken()`; o alarme existe apenas
  // para o popup abrir instantâneo, não para girar token à toa.
  const access = await readAccess();
  const folga = (access?.expiresAt ?? 0) - Date.now();
  if (folga > ACCESS_REFRESH_MARGIN_SECONDS * 1000 * 2) return;

  try {
    await refreshAccess();
  } catch (_) {
    // Sessão revogada no servidor: o próximo uso mostra a tela de login.
  }
});
