// Popup. Não tem token, não tem segredo guardado, não fala com a rede: tudo
// passa por mensagem para o service worker.
//
// Toda escrita de texto vindo do servidor usa `textContent`. Não há um único
// `innerHTML` com dado de usuário — é assim que um nome de chave com
// `<img onerror=…>` continua sendo só um nome esquisito. Pelo mesmo motivo os
// ícones nascem de `createElementNS` e de uma tabela de paths fixa, e não de
// um trecho de HTML montado em string.

import { lerQrDeImagem, juntarPayload } from '../lib/qr.js';
import { aplicarTemaGuardado, salvarTema } from '../lib/tema.js';
import { CRM_AUTHENTICATOR_URL } from '../lib/config.js';

// ── ponte com o service worker ──────────────────────────────────────────────

async function pedir(acao, dados) {
  const resposta = await chrome.runtime.sendMessage({ acao, dados });
  if (!resposta) throw new Error('A extensão não respondeu. Tente reabrir.');
  if (resposta.erro) {
    const erro = new Error(resposta.erro);
    erro.status = resposta.status;
    throw erro;
  }
  return resposta.resultado;
}

// ── utilidades de tela ──────────────────────────────────────────────────────

const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];

const NS_SVG = 'http://www.w3.org/2000/svg';

/** Ícones como dados, nunca como HTML montado em string. */
const ICONES = {
  copiar: [
    ['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2.5 }],
    ['path', { d: 'M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15' }],
  ],
  seta: [['path', { d: 'm9 5 7 7-7 7' }]],
  estrela: [['path', { d: 'M12 3.6 14.6 9l5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.8 1-5.75-4.2-4.1L9.4 9 12 3.6Z' }]],
  gente: [
    ['circle', { cx: 9, cy: 8, r: 3 }],
    ['path', { d: 'M3 19c.5-2.8 2.9-4.3 6-4.3M16.5 6.2a3 3 0 0 1 0 5.6M18 19c-.2-1.6-.9-2.8-2-3.6' }],
  ],
  certo: [['path', { d: 'm4 12.5 5.5 5.5L20 6.5' }]],
  saida: [
    ['path', { d: 'M14 4h6v6' }],
    ['path', { d: 'M20 4 11 13' }],
    ['path', { d: 'M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10' }],
  ],
};

function icone(nome) {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const [tag, atributos] of ICONES[nome]) {
    const el = document.createElementNS(NS_SVG, tag);
    for (const [chave, valor] of Object.entries(atributos)) el.setAttribute(chave, String(valor));
    svg.append(el);
  }
  return svg;
}

const pilha = [];

function ir(nome, { empilhar = true } = {}) {
  const atual = $('.tela:not(.oculto)')?.dataset.tela;
  if (empilhar && atual && atual !== nome) pilha.push(atual);
  $$('.tela').forEach((tela) => tela.classList.toggle('oculto', tela.dataset.tela !== nome));
  if (nome === 'lista') return;
  const foco = $$(`[data-tela="${nome}"] input, [data-tela="${nome}"] textarea`)
    .find((campo) => campo.type !== 'file' && campo.type !== 'hidden' && campo.offsetParent !== null);
  if (foco) setTimeout(() => foco.focus(), 30);
}

function voltar() {
  const anterior = pilha.pop() ?? 'lista';
  ir(anterior, { empilhar: false });
  if (anterior === 'lista') carregarLista();
}

let brindeTimer;
function brinde(texto, tipo = 'ok') {
  const el = $('#brinde');
  el.textContent = texto;
  el.classList.toggle('erro-toast', tipo === 'erro');
  el.classList.add('visivel');
  clearTimeout(brindeTimer);
  brindeTimer = setTimeout(() => el.classList.remove('visivel'), 2200);
}

function mostrarErro(chave, mensagem) {
  const el = typeof chave === 'string' ? $(`[data-erro="${chave}"]`) || $(`#${chave}`) : chave;
  if (!el) return brinde(mensagem, 'erro');
  el.textContent = mensagem;
  el.classList.remove('oculto');
}

function limparErro(chave) {
  const el = typeof chave === 'string' ? $(`[data-erro="${chave}"]`) || $(`#${chave}`) : chave;
  if (el) el.classList.add('oculto');
}

function iniciais(nome) {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

const NO_MAC = navigator.userAgent.includes('Mac');

// ── abertura ────────────────────────────────────────────────────────────────
//
// O loader cobre trabalho real. Um piso curto evita um clarão caso a resposta
// venha no mesmo quadro, sem obrigar a pessoa a assistir a uma coreografia.

const ABERTA_EM = performance.now();
const PISO_DA_ABERTURA = 360;

function fecharAbertura() {
  const abertura = $('#abertura');
  if (!abertura || abertura.classList.contains('saindo')) return;

  const falta = Math.max(0, PISO_DA_ABERTURA - (performance.now() - ABERTA_EM));
  setTimeout(() => {
    abertura.classList.add('saindo');
    setTimeout(() => {
      abertura.remove();
    }, 220);
  }, falta);
}

// ── estado do popup ─────────────────────────────────────────────────────────

const estado = {
  credenciais: [],
  codigos: new Map(),      // id → { code, period, expiresAt (ms), digits }
  deltaRelogio: 0,         // servidor − navegador, em ms
  periodoDoRelogio: 30,    // o período que a barra do topo representa
  tema: 'sistema',         // sistema | claro | escuro
  filtro: '',
  linhaAtiva: null,        // a chave que o teclado e o ⌘C usam
  detalheId: null,
  detalhePeriodo: 30,
  compartilharId: null,
  compartilharUsuario: null,
  importacao: null,
};

let tickTimer = null;
let recargaTimer = null;

// ── autenticação ────────────────────────────────────────────────────────────

async function iniciar() {
  // Antes de tudo: se a pessoa escolheu claro ou escuro, a tela já nasce assim.
  estado.tema = await aplicarTemaGuardado();

  $('#tecla-copiar').textContent = NO_MAC ? '⌘C' : 'Ctrl+C';
  $('#tecla-colar').textContent = NO_MAC ? '⌘V' : 'Ctrl+V';

  try {
    const { autenticado } = await pedir('estado');
    if (!autenticado) {
      ir('login', { empilhar: false });
      return fecharAbertura();
    }
    ir('lista', { empilhar: false });
    await carregarLista();
    fecharAbertura();

    // A janela da câmera não consegue abrir o popup (isso exige gesto do
    // usuário no ícone). Ela deixa a análise pronta e quem chega aqui a
    // encontra — o popup abre já na tela de escolher o que importar.
    const pendente = await pedir('importacaoPendente');
    if (pendente?.itens?.length) {
      estado.importacao = { payload: pendente.payload, itens: pendente.itens, pulados: pendente.pulados };
      renderizarImportacao();
      ir('importar');
    }
  } catch (erro) {
    ir('login', { empilhar: false });
    mostrarErro('login-erro', erro.message);
    fecharAbertura();
  }
}

// ── login em duas etapas ────────────────────────────────────────────────────
//
// Etapa 1 prova a CONTA (e-mail + senha). Etapa 2 prova a PESSOA (PIN).
//
// A separação não é enfeite: se a senha estiver errada, não faz sentido pedir o
// PIN — e pedir os dois de uma vez esconde qual dos dois falhou. O servidor já
// confere nessa ordem e responde 428 ("falta o PIN") só depois de a senha
// passar, então é ele quem decide quando a segunda etapa começa.

function irParaEtapaPin(email) {
  $('#login-etapa-conta').classList.add('oculto');
  $('#login-etapa-pin').classList.remove('oculto');
  $('#login-nome').textContent = email.split('@')[0] ?? email;
  $('#login-conferido').textContent = email;
  $('#login-iniciais').textContent = iniciais(email.split('@')[0]?.replace(/[._-]+/g, ' '));
  limparPin();
  setTimeout(() => caixasDoPin[0].focus(), 40);
}

function voltarParaConta() {
  $('#login-etapa-conta').classList.remove('oculto');
  $('#login-etapa-pin').classList.add('oculto');
  limparPin();
  $('#login-senha').value = '';
  limparErro('login-erro');
  limparErro('pin-erro');
  setTimeout(() => $('#login-email').focus(), 40);
}

// ── PIN em seis casas ───────────────────────────────────────────────────────
//
// Seis casas, e não um campo só: o PIN do CRM tem exatamente seis dígitos
// (src/services/securityPin.service.ts), então a forma do campo pode dizer
// isso sem precisar de texto. Cada casa é `type=text` com `-webkit-text-
// security` no CSS — `type=password` recusaria a colagem dígito a dígito.

const caixasDoPin = $$('#pin-caixas input');

function lerPin() {
  return caixasDoPin.map((caixa) => caixa.value).join('');
}

function limparPin() {
  caixasDoPin.forEach((caixa) => { caixa.value = ''; });
}

caixasDoPin.forEach((caixa, indice) => {
  caixa.addEventListener('input', () => {
    caixa.value = caixa.value.replace(/\D/g, '').slice(0, 1);
    if (caixa.value && indice < caixasDoPin.length - 1) caixasDoPin[indice + 1].focus();
    if (lerPin().length === caixasDoPin.length) $('#form-pin').requestSubmit();
  });

  caixa.addEventListener('keydown', (evento) => {
    if (evento.key === 'Backspace' && !caixa.value && indice > 0) {
      evento.preventDefault();
      caixasDoPin[indice - 1].focus();
      caixasDoPin[indice - 1].value = '';
    }
    if (evento.key === 'ArrowLeft' && indice > 0) caixasDoPin[indice - 1].focus();
    if (evento.key === 'ArrowRight' && indice < caixasDoPin.length - 1) caixasDoPin[indice + 1].focus();
  });

  // Colar o PIN inteiro numa casa espalha pelas seis.
  caixa.addEventListener('paste', (evento) => {
    const digitos = (evento.clipboardData?.getData('text') ?? '').replace(/\D/g, '');
    if (!digitos) return;
    evento.preventDefault();
    for (let i = 0; i < caixasDoPin.length - indice; i += 1) {
      caixasDoPin[indice + i].value = digitos[i] ?? '';
    }
    const ultima = Math.min(indice + digitos.length, caixasDoPin.length - 1);
    caixasDoPin[ultima].focus();
    if (lerPin().length === caixasDoPin.length) $('#form-pin').requestSubmit();
  });
});

$('#login-voltar').addEventListener('click', voltarParaConta);

$('#form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro('login-erro');

  const botao = $('#login-enviar');
  const campoSenha = $('#login-senha');
  const email = $('#login-email').value;

  botao.disabled = true;
  botao.textContent = 'Conferindo…';

  try {
    // Na etapa 1 o PIN vai vazio de propósito: é o 428 do servidor que diz
    // "a senha está certa, agora peça o PIN".
    await pedir('entrar', { email, senha: campoSenha.value, pin: '' });
    campoSenha.value = '';
    voltarParaConta();
    ir('lista', { empilhar: false });
    await carregarLista();
  } catch (erro) {
    if (erro.status === 428) {
      irParaEtapaPin(email);          // senha aceita; só falta o PIN
    } else {
      campoSenha.value = '';
      mostrarErro('login-erro', erro.message);
    }
  } finally {
    botao.disabled = false;
    botao.textContent = 'Continuar';
  }
});

$('#form-pin').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro('pin-erro');

  const pin = lerPin();
  if (pin.length !== caixasDoPin.length) return mostrarErro('pin-erro', 'Digite os seis dígitos do PIN.');

  const botao = $('#pin-enviar');
  const campoSenha = $('#login-senha');
  botao.disabled = true;
  botao.textContent = 'Entrando…';

  try {
    await pedir('entrar', { email: $('#login-email').value, senha: campoSenha.value, pin });
    // Senha e PIN somem do DOM assim que deixam de ser necessários.
    campoSenha.value = '';
    voltarParaConta();
    ir('lista', { empilhar: false });
    await carregarLista();
  } catch (erro) {
    limparPin();
    caixasDoPin[0].focus();
    mostrarErro('pin-erro', erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Autorizar';
  }
});

// ── lista de códigos ────────────────────────────────────────────────────────

async function carregarLista() {
  const alvo = $('#lista');
  if (estado.credenciais.length === 0) {
    alvo.replaceChildren(...[0, 1, 2].map(() => {
      const el = document.createElement('div');
      el.className = 'esqueleto';
      return el;
    }));
  }

  try {
    const { credentials } = await pedir('listar');
    estado.credenciais = credentials;
    await carregarCodigos();
    renderizarLista();
  } catch (erro) {
    if (erro.status === 401) return ir('login', { empilhar: false });
    alvo.replaceChildren(vazio('Não foi possível carregar', erro.message, () => carregarLista()));
  }
}

async function carregarCodigos() {
  try {
    const { codes, server_time } = await pedir('codigos');
    // O contador segue o relógio do SERVIDOR: se o computador está adiantado,
    // a barra ainda esvazia na hora certa.
    estado.deltaRelogio = server_time * 1000 - Date.now();

    estado.codigos = new Map();
    for (const item of codes) {
      if (item.error) {
        estado.codigos.set(item.credential_id, { erro: item.error });
        continue;
      }
      estado.codigos.set(item.credential_id, {
        code: item.code,
        period: item.period,
        digits: item.digits,
        expiraEm: Date.now() + estado.deltaRelogio + item.expires_in * 1000,
      });
    }
    estado.periodoDoRelogio = periodoDominante();
    agendarRecarga();
  } catch (erro) {
    if (erro.status === 401) throw erro;
    estado.codigos = new Map();
    brinde('Cofre indisponível. Os códigos voltam quando a conexão voltar.', 'erro');
  }
}

/**
 * QUAL PERÍODO A BARRA DE CIMA REPRESENTA.
 *
 * Todo código TOTP de 30s vira no mesmo instante — é a mesma janela do mesmo
 * relógio universal —, então um contador por linha repetia a mesma informação
 * uma vez por chave. A barra do topo é esse contador único, e ela segue o
 * período MAIS COMUM da lista. Chave que foge dele (60s, 15s) mostra o anel
 * próprio na linha, e é justamente por serem raras que os anéis significam
 * alguma coisa quando aparecem.
 */
function periodoDominante() {
  const contagem = new Map();
  for (const dados of estado.codigos.values()) {
    if (!dados.period) continue;
    contagem.set(dados.period, (contagem.get(dados.period) ?? 0) + 1);
  }
  let dominante = 30;
  let maior = 0;
  for (const [periodo, quantas] of contagem) {
    if (quantas > maior) { dominante = periodo; maior = quantas; }
  }
  return dominante;
}

/** Recarrega quando o código mais próximo virar — nunca antes, nunca depois. */
function agendarRecarga() {
  clearTimeout(recargaTimer);
  const proximos = [...estado.codigos.values()].filter((c) => c.expiraEm).map((c) => c.expiraEm);
  if (proximos.length === 0) return;
  const espera = Math.max(500, Math.min(...proximos) - (Date.now() + estado.deltaRelogio) + 250);
  recargaTimer = setTimeout(async () => {
    await carregarCodigos();
    renderizarLista();
  }, espera);
}

function vazio(titulo, texto, aoClicar) {
  const el = document.createElement('div');
  el.className = 'vazio';
  const forte = document.createElement('strong');
  forte.textContent = titulo;
  const p = document.createElement('p');
  p.textContent = texto;
  p.className = 'aviso-texto';
  el.append(forte, p);
  if (aoClicar) {
    const botao = document.createElement('button');
    botao.className = 'link link--espacado';
    botao.textContent = 'Tentar de novo';
    botao.addEventListener('click', aoClicar);
    el.append(botao);
  }
  return el;
}

function semAcento(texto) {
  return String(texto ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function renderizarLista() {
  const alvo = $('#lista');
  const termo = semAcento(estado.filtro);
  const visiveis = estado.credenciais.filter((c) => {
    if (!termo) return true;
    return semAcento(`${c.name} ${c.issuer ?? ''} ${c.account_label ?? ''}`).includes(termo);
  });

  if (estado.credenciais.length === 0) {
    alvo.replaceChildren(vazio('Nenhuma chave ainda', 'Cadastre a primeira no + do cabeçalho, ou importe do Google Authenticator.'));
    return;
  }
  if (visiveis.length === 0) {
    alvo.replaceChildren(vazio('Nada encontrado', `Nenhuma chave com "${estado.filtro}".`));
    return;
  }

  // Favorito primeiro, e dentro de cada grupo em ordem alfabética. Quem marcou
  // uma estrela quer aquela chave à mão — não rolando a lista. Os títulos de
  // grupo substituem a estrela repetida em toda linha.
  const ordenar = (a, b) => semAcento(a.name).localeCompare(semAcento(b.name), 'pt-BR');
  const favoritas = visiveis.filter((c) => c.favorite).sort(ordenar);
  const demais = visiveis.filter((c) => !c.favorite).sort(ordenar);

  const filhos = [];
  if (favoritas.length) {
    filhos.push(tituloDeGrupo('Favoritas'), ...favoritas.map(cartao));
    if (demais.length) filhos.push(tituloDeGrupo('Todas as chaves'));
  }
  filhos.push(...demais.map(cartao));

  alvo.replaceChildren(...filhos);
  if (!visiveis.some((c) => c.id === estado.linhaAtiva)) estado.linhaAtiva = visiveis[0]?.id ?? null;
  atualizarContadores();
}

function tituloDeGrupo(texto) {
  const el = document.createElement('div');
  el.className = 'grupo-titulo';
  el.textContent = texto;
  return el;
}

function cartao(credencial) {
  const item = document.createElement('div');
  item.className = 'item';
  item.dataset.id = credencial.id;
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-label', `Preencher o código de ${credencial.name}`);

  // ── a linha de cima: quem é a chave ──
  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const nome = document.createElement('b');
  nome.textContent = credencial.name;
  meta.append(nome);

  const conta = credencial.account_label || credencial.issuer;
  if (conta) {
    meta.append(separador(), textoCortado(conta));
  }
  if (credencial.shared || !credencial.is_owner) {
    meta.append(separador(), icone('gente'));
    const quantas = document.createElement('span');
    quantas.textContent = credencial.is_owner
      ? String(credencial.shared_count ?? '')
      : `de ${credencial.owner_name ?? 'outro'}`;
    meta.append(quantas);
  }

  const dados = estado.codigos.get(credencial.id);
  const periodoProprio = dados?.period && dados.period !== estado.periodoDoRelogio;
  if (periodoProprio) {
    meta.append(separador(), Object.assign(document.createElement('span'), { textContent: `${dados.period}s` }));
  }

  // ── a linha de baixo: o código ──
  const codigo = document.createElement('div');
  codigo.className = 'item-codigo num';
  codigo.dataset.papel = 'codigo';

  const feito = document.createElement('div');
  feito.className = 'item-feito oculto';
  feito.dataset.papel = 'feito';
  feito.append(icone('certo'), Object.assign(document.createElement('span'), { textContent: 'Preenchido na página' }));

  // ── o lado direito: só aparece na linha sob o cursor ──
  const preencher = document.createElement('button');
  preencher.className = 'item-preencher';
  preencher.type = 'button';
  preencher.textContent = 'Preencher';
  preencher.dataset.papel = 'preencher';
  preencher.title = 'Escrever o código no campo da página aberta';
  preencher.addEventListener('click', (evento) => { evento.stopPropagation(); preencherCom(credencial.id, item); });

  const estrela = document.createElement('button');
  estrela.className = `item-acao${credencial.favorite ? ' marcada' : ''}`;
  estrela.type = 'button';
  estrela.title = credencial.favorite ? 'Remover dos favoritos' : 'Favoritar';
  estrela.setAttribute('aria-label', estrela.title);
  estrela.append(icone('estrela'));
  estrela.addEventListener('click', async (evento) => {
    evento.stopPropagation();
    try {
      await pedir('favoritar', { id: credencial.id, favorito: !credencial.favorite });
      credencial.favorite = !credencial.favorite;
      renderizarLista();
    } catch (erro) { brinde(erro.message, 'erro'); }
  });

  const copiar = document.createElement('button');
  copiar.className = 'item-acao';
  copiar.type = 'button';
  copiar.title = 'Copiar código';
  copiar.setAttribute('aria-label', `Copiar o código de ${credencial.name}`);
  copiar.dataset.papel = 'copiar';
  copiar.append(icone('copiar'));
  copiar.addEventListener('click', (evento) => { evento.stopPropagation(); copiarCodigo(credencial.id); });

  const abrir = document.createElement('button');
  abrir.className = 'item-acao';
  abrir.type = 'button';
  abrir.title = 'Detalhes';
  abrir.setAttribute('aria-label', `Detalhes de ${credencial.name}`);
  abrir.append(icone('seta'));
  abrir.addEventListener('click', (evento) => { evento.stopPropagation(); abrirDetalhe(credencial.id); });

  const lado = document.createElement('div');
  lado.className = 'item-lado';
  lado.append(preencher, estrela, copiar, abrir);
  if (periodoProprio) lado.append(anel(credencial.id));

  item.append(meta, codigo, feito, lado);

  // A linha inteira é o botão principal: quem abre o popup num site de login
  // quer o código NO campo, não na área de transferência.
  item.addEventListener('click', () => preencherCom(credencial.id, item));
  item.addEventListener('mouseenter', () => { estado.linhaAtiva = credencial.id; });
  item.addEventListener('focus', () => { estado.linhaAtiva = credencial.id; });
  item.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      preencherCom(credencial.id, item);
    }
  });

  return item;
}

function separador() {
  const el = document.createElement('span');
  el.textContent = '·';
  return el;
}

function textoCortado(texto) {
  const el = document.createElement('span');
  el.className = 'corte';
  el.textContent = texto;
  return el;
}

/** O anel da linha — só para a chave cujo período foge do relógio de cima. */
function anel(id) {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 22 22');
  svg.setAttribute('class', 'item-aro');
  svg.setAttribute('aria-hidden', 'true');
  for (const classe of ['aro-fundo', 'aro-frente']) {
    const circulo = document.createElementNS(NS_SVG, 'circle');
    circulo.setAttribute('cx', '11');
    circulo.setAttribute('cy', '11');
    circulo.setAttribute('r', '8');
    circulo.setAttribute('class', classe);
    if (classe === 'aro-frente') circulo.dataset.aroDe = id;
    svg.append(circulo);
  }
  return svg;
}

// ── ações de uma chave ──────────────────────────────────────────────────────

async function copiarCodigo(id) {
  const atual = estado.codigos.get(id);
  if (!atual?.code) return brinde('Código indisponível.', 'erro');
  try {
    // Só vai para a área de transferência com clique ou atalho. Não existe
    // cópia automática, nem leitura de página, nem vigia de formulário.
    await navigator.clipboard.writeText(atual.code);
    brinde('Código copiado');
  } catch (_) {
    brinde('O navegador bloqueou a cópia.', 'erro');
  }
}

async function preencherCom(id, item) {
  const preencher = $('[data-papel="preencher"]', item);
  const codigo = $('[data-papel="codigo"]', item);
  const feito = $('[data-papel="feito"]', item);
  if (preencher.disabled) return;

  preencher.disabled = true;
  try {
    // O popup não toca na aba: ele pede, e quem escreve é o service worker —
    // que também é quem busca um código novo, para não preencher um vencido.
    await pedir('preencher', { id });
    codigo.classList.add('oculto');
    feito.classList.remove('oculto');
    setTimeout(() => window.close(), 650);
  } catch (erro) {
    brinde(erro.message, 'erro');
  } finally {
    preencher.disabled = false;
  }
}

// ── o que muda a cada segundo ───────────────────────────────────────────────
//
// A CSP da extensão é `style-src 'self'`, e ela não recusa só o atributo
// `style=` escrito no HTML: recusa também o que o JavaScript escreve por
// `elemento.style.alguma-coisa`. Afrouxá-la com `unsafe-inline` resolveria numa
// linha e abriria a porta por onde entraria estilo injetado.
//
// A saída certa é uma folha ADOTADA: CSSOM programático não é estilo inline,
// então a CSP não tem o que barrar. Regra de bolso: valor fixo vira classe;
// valor que muda a cada segundo vira regra nesta folha. Tudo é acumulado e
// escrito UMA vez por tique — uma chamada de `replaceSync` por elemento faria o
// trabalho crescer com o quadrado do número de chaves.

const folhaViva = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, folhaViva];

const CIRCUNFERENCIA_DO_ANEL = 2 * Math.PI * 8;    // raio 8, o anel da linha
const CIRCUNFERENCIA_DO_PALCO = 2 * Math.PI * 14;  // raio 14, o anel do detalhe

function escrever(regras) {
  folhaViva.replaceSync(regras.join('\n'));
}

function atualizarContadores() {
  const agora = Date.now() + estado.deltaRelogio;
  const regras = [];

  // ── o relógio compartilhado ──
  const doRelogio = [...estado.codigos.values()].find((c) => c.period === estado.periodoDoRelogio && c.expiraEm);
  const relogio = $('#relogio');
  if (doRelogio) {
    const restante = Math.max(0, Math.ceil((doRelogio.expiraEm - agora) / 1000));
    relogio.classList.remove('oculto');
    relogio.classList.toggle('urgente', restante <= 7);
    $('#relogio-seg').textContent = `${restante}s`;
    regras.push(`#relogio-barra{width:${((restante / estado.periodoDoRelogio) * 100).toFixed(2)}%}`);
  } else {
    relogio.classList.add('oculto');
  }

  // ── as linhas ──
  for (const item of $$('.item')) {
    const dados = estado.codigos.get(item.dataset.id);
    const codigo = $('[data-papel="codigo"]', item);
    const preencher = $('[data-papel="preencher"]', item);
    const copiar = $('[data-papel="copiar"]', item);

    item.classList.toggle('ativa', item.dataset.id === estado.linhaAtiva);

    if (!dados || dados.erro) {
      codigo.replaceChildren(dados?.erro ?? '······');
      codigo.classList.toggle('indisponivel', Boolean(dados?.erro));
      preencher.disabled = true;
      copiar.disabled = true;
      continue;
    }

    const restante = Math.max(0, Math.ceil((dados.expiraEm - agora) / 1000));

    // Dois trios em elementos separados, para o CSS controlar o respiro entre
    // eles. Um espaço solto no texto sairia com a largura de um espaço comum,
    // larga demais, e é o que fazia o código parecer quebrado ao meio.
    const meio = Math.ceil(dados.code.length / 2);
    codigo.replaceChildren(...[dados.code.slice(0, meio), dados.code.slice(meio)].map((parte) => {
      const trio = document.createElement('span');
      trio.textContent = parte;
      return trio;
    }));
    codigo.classList.remove('indisponivel');

    // Nos 7 segundos finais, o código fica vermelho: vale mais esperar o
    // próximo do que digitar um que vira no meio do caminho.
    item.classList.toggle('esvai', restante <= 7);
    item.classList.toggle('urgente', restante <= 7);
    preencher.disabled = false;
    copiar.disabled = false;

    const aro = $('.aro-frente[data-aro-de]', item);
    if (aro) {
      const sobra = CIRCUNFERENCIA_DO_ANEL * (1 - restante / dados.period);
      // `.item-aro .aro-frente[…]` (0,3,0) vence `.item-aro .aro-frente` (0,2,0).
      regras.push(`.item-aro .aro-frente[data-aro-de="${CSS.escape(item.dataset.id)}"]{stroke-dashoffset:${sobra.toFixed(2)}}`);
    }
  }

  // ── o palco do detalhe, se estiver aberto ──
  if ($('.tela:not(.oculto)')?.dataset.tela === 'detalhe' && estado.detalheId) {
    const dados = estado.codigos.get(estado.detalheId);
    const palco = $('#detalhe-palco');
    const codigo = $('#detalhe-codigo');
    if (dados?.code) {
      const restante = Math.max(0, Math.ceil((dados.expiraEm - agora) / 1000));
      const meio = Math.ceil(dados.code.length / 2);
      codigo.replaceChildren(...[dados.code.slice(0, meio), dados.code.slice(meio)].map((parte) => {
        const trio = document.createElement('span');
        trio.textContent = parte;
        return trio;
      }));
      codigo.classList.remove('indisponivel');
      palco.classList.remove('oculto');
      palco.classList.toggle('urgente', restante <= 7);
      $('#detalhe-aro').classList.toggle('urgente', restante <= 7);
      const sobra = CIRCUNFERENCIA_DO_PALCO * (1 - restante / (dados.period || 30));
      regras.push(`#detalhe-aro .aro-frente{stroke-dashoffset:${sobra.toFixed(2)}}`);
    } else if (dados?.erro) {
      codigo.textContent = dados.erro;
      codigo.classList.add('indisponivel');
      palco.classList.remove('oculto', 'urgente');
    } else {
      palco.classList.add('oculto');
    }
  }

  if (regraDoSegredo) regras.push(regraDoSegredo);
  escrever(regras);
}

// ── busca ───────────────────────────────────────────────────────────────────

function alternarBusca(abrir) {
  const caixa = $('#caixa-busca');
  const querAbrir = abrir ?? caixa.classList.contains('oculto');
  caixa.classList.toggle('oculto', !querAbrir);
  $('#abrir-busca').classList.toggle('ativo', querAbrir);
  if (querAbrir) {
    $('#busca').focus();
  } else if (estado.filtro) {
    $('#busca').value = '';
    estado.filtro = '';
    renderizarLista();
  }
}

$('#abrir-busca').addEventListener('click', () => alternarBusca());

$('#busca').addEventListener('input', (evento) => {
  estado.filtro = evento.target.value;
  renderizarLista();
});

// ── detalhe ─────────────────────────────────────────────────────────────────

async function abrirDetalhe(id) {
  estado.detalheId = id;
  ir('detalhe');
  $('#detalhe-palco').classList.add('oculto');
  $('#detalhe-copiar').classList.add('oculto');
  const corpo = $('#detalhe-corpo');
  corpo.replaceChildren(Object.assign(document.createElement('div'), { className: 'esqueleto' }));

  try {
    const [{ credential }, permissoes] = await Promise.all([
      pedir('detalhe', { id }),
      pedir('permissoes', { id }).catch(() => null),
    ]);

    $('#detalhe-nome').textContent = credential.name;
    $('#detalhe-copiar').classList.toggle('oculto', !estado.codigos.get(id)?.code);
    corpo.replaceChildren();
    atualizarContadores();

    const info = document.createElement('div');
    info.className = 'bloco';
    info.append(rotulo('A chave'));
    if (credential.issuer) info.append(linhaInfo('Emissor', credential.issuer));
    if (credential.account_label) info.append(linhaInfo('Conta', credential.account_label));
    info.append(linhaInfo('Formato', `${credential.algorithm} · ${credential.digits} dígitos · ${credential.period}s`));
    info.append(linhaInfo('Seu nível', credential.is_owner ? 'PROPRIETÁRIO' : credential.role));
    if (credential.status === 'archived') info.append(linhaInfo('Situação', 'Arquivada (não gera código)'));
    corpo.append(info);

    if (permissoes) {
      const bloco = document.createElement('div');
      bloco.className = 'bloco';
      bloco.append(rotulo('Quem tem acesso'));
      bloco.append(pessoa(permissoes.owner.name ?? permissoes.owner.email, permissoes.owner.email, 'DONO'));
      for (const p of permissoes.permissions) {
        const linha = pessoa(p.name ?? p.email, p.email, p.permission);
        if (credential.can_manage) {
          const remover = document.createElement('button');
          remover.className = 'link link--perigo';
          remover.textContent = 'Remover';
          remover.addEventListener('click', async () => {
            try {
              await pedir('revogar', { id, userId: p.user_id });
              brinde('Acesso removido');
              abrirDetalhe(id);
            } catch (erro) { brinde(erro.message, 'erro'); }
          });
          linha.append(remover);
        }
        bloco.append(linha);
      }
      corpo.append(bloco);
    }

    const acoes = document.createElement('div');
    acoes.className = 'acoes-detalhe';

    if (credential.can_manage) {
      acoes.append(botao('Compartilhar com alguém', () => abrirCompartilhar(id)));
      acoes.append(botao(credential.status === 'archived' ? 'Reativar' : 'Arquivar', async () => {
        try {
          await pedir('atualizar', { id, dados: { status: credential.status === 'archived' ? 'active' : 'archived' } });
          brinde(credential.status === 'archived' ? 'Chave reativada' : 'Chave arquivada');
          abrirDetalhe(id);
        } catch (erro) { brinde(erro.message, 'erro'); }
      }));
    }

    if (credential.can_export) {
      const exportar = botao('Exportar o segredo…', async () => {
        const confirmacao = await pedirConfirmacao({
          texto: 'Exportar o segredo original desta chave é registrado na auditoria. Diga por que precisa dele e confirme com a sua senha.',
          pedirMotivo: true,
        });
        if (!confirmacao) return;
        try {
          const resultado = await pedir('exportar', { id, motivo: confirmacao.motivo, stepUpToken: confirmacao.token });
          mostrarSegredo(resultado, credential.name);
        } catch (erro) { brinde(erro.message, 'erro'); }
      });
      exportar.classList.remove('botao--sec');
      exportar.classList.add('botao--perigo');
      acoes.append(exportar);
    }

    if (credential.is_owner) {
      acoes.append(botao('Transferir propriedade', () => abrirTransferencia(id)));
      const excluir = botao('Excluir chave', async () => {
        if (!window.confirm('Excluir esta chave? Ela sai da sua lista e fica retida na auditoria.')) return;
        try {
          await pedir('excluir', { id, motivo: 'excluída pelo proprietário na extensão' });
          brinde('Chave excluída');
          estado.credenciais = estado.credenciais.filter((c) => c.id !== id);
          ir('lista', { empilhar: false });
          carregarLista();
        } catch (erro) { brinde(erro.message, 'erro'); }
      });
      excluir.classList.remove('botao--sec');
      excluir.classList.add('botao--perigo');
      acoes.append(excluir);
    }

    corpo.append(acoes);
  } catch (erro) {
    corpo.replaceChildren(vazio('Não foi possível abrir', erro.message));
  }
}

$('#detalhe-copiar').addEventListener('click', () => copiarCodigo(estado.detalheId));

function rotulo(texto) {
  const h = document.createElement('h2');
  h.textContent = texto;
  return h;
}

function linhaInfo(chave, valor) {
  const el = document.createElement('div');
  el.className = 'linha-info';
  const k = document.createElement('span');
  k.className = 'linha-info__chave';
  k.textContent = chave;
  const v = document.createElement('span');
  v.className = 'linha-info__valor';
  v.textContent = valor;
  el.append(k, v);
  return el;
}

function pessoa(nome, email, nivel) {
  const el = document.createElement('div');
  el.className = 'pessoa';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = iniciais(nome);
  const quem = document.createElement('div');
  quem.className = 'quem';
  const b = document.createElement('b');
  b.textContent = nome ?? '—';
  const small = document.createElement('small');
  small.textContent = email ?? '';
  quem.append(b, small);
  const tag = document.createElement('span');
  tag.className = 'nivel';
  tag.textContent = nivel;
  el.append(avatar, quem, tag);
  return el;
}

function botao(texto, aoClicar) {
  const el = document.createElement('button');
  el.className = 'botao botao--sec';
  el.type = 'button';
  el.textContent = texto;
  el.addEventListener('click', aoClicar);
  return el;
}

// ── confirmação de identidade (step-up) ─────────────────────────────────────

let confirmacaoPendente = null;

function pedirConfirmacao({ texto, pedirMotivo }) {
  $('#confirmar-motivo-texto').textContent = texto;
  $('#campo-motivo').classList.toggle('oculto', !pedirMotivo);
  $('#confirmar-motivo').value = '';
  $('#confirmar-senha').value = '';
  limparErro('confirmar');
  ir('confirmar');

  return new Promise((resolver) => { confirmacaoPendente = { resolver, pedirMotivo }; });
}

$('#form-confirmar').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!confirmacaoPendente) return;
  limparErro('confirmar');

  const motivo = $('#confirmar-motivo').value.trim();
  if (confirmacaoPendente.pedirMotivo && motivo.length < 10) {
    return mostrarErro('confirmar', 'Escreva o motivo com pelo menos 10 caracteres.');
  }

  const campoSenha = $('#confirmar-senha');
  try {
    const { step_up_token } = await pedir('confirmarIdentidade', { senha: campoSenha.value });
    campoSenha.value = '';
    const pendente = confirmacaoPendente;
    confirmacaoPendente = null;
    voltar();
    pendente.resolver({ token: step_up_token, motivo });
  } catch (erro) {
    campoSenha.value = '';
    mostrarErro('confirmar', erro.message);
  }
});

// ── segredo revelado ────────────────────────────────────────────────────────

let segredoTimer = null;
let regraDoSegredo = null;    // a barra da contagem, escrita na folha viva

const SEGUNDOS_DO_SEGREDO = 120;

function mostrarSegredo({ secret, uri }, nomeDaChave) {
  $('#segredo-titulo').textContent = nomeDaChave ? `Segredo · ${nomeDaChave}` : 'Segredo';
  $('#segredo-valor').textContent = secret;
  $('#segredo-uri').textContent = uri;
  ir('segredo');

  let restante = SEGUNDOS_DO_SEGREDO;
  clearInterval(segredoTimer);

  const pintar = () => {
    const minutos = Math.floor(Math.max(0, restante) / 60);
    const segundos = Math.max(0, restante) % 60;
    $('#segredo-contador').textContent = `${minutos}:${String(segundos).padStart(2, '0')}`;
    regraDoSegredo = `#segredo-trilho{width:${((Math.max(0, restante) / SEGUNDOS_DO_SEGREDO) * 100).toFixed(2)}%}`;
  };

  pintar();
  atualizarContadores();

  segredoTimer = setInterval(() => {
    restante -= 1;
    pintar();
    if (restante <= 0) {
      clearInterval(segredoTimer);
      // O segredo sai do DOM — não fica esperando alguém reabrir o popup.
      $('#segredo-valor').textContent = '(oculto)';
      $('#segredo-uri').textContent = '(oculto)';
    }
  }, 1000);
}

$('#segredo-copiar').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#segredo-valor').textContent);
  brinde('Segredo copiado');
});
$('#segredo-copiar-uri').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#segredo-uri').textContent);
  brinde('URI copiada');
});

// ── nova chave ──────────────────────────────────────────────────────────────

$('#abrir-nova').addEventListener('click', () => {
  $('#form-manual').reset();
  $('#uri-texto').value = '';
  ['nova', 'uri', 'qr'].forEach(limparErro);
  ir('nova');
});

$$('.segmentado button').forEach((aba) => {
  aba.addEventListener('click', () => {
    $$('.segmentado button').forEach((a) => a.classList.toggle('ativa', a === aba));
    $$('[data-painel]').forEach((p) => p.classList.toggle('oculto', p.dataset.painel !== aba.dataset.aba));
  });
});

// 99% das chaves são SHA1 · 6 · 30s: três selects logo de cara só atrapalham.
$('#abrir-avancado').addEventListener('click', () => {
  const botaoMais = $('#abrir-avancado');
  const aberto = $('#avancado').classList.toggle('oculto') === false;
  botaoMais.classList.toggle('aberta', aberto);
  botaoMais.setAttribute('aria-expanded', String(aberto));
});

$('#form-manual').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro('nova');
  const campoSecret = $('#nova-secret');
  try {
    await pedir('criar', {
      dados: {
        name: $('#nova-nome').value.trim(),
        issuer: $('#nova-issuer').value.trim() || null,
        account_label: $('#nova-conta').value.trim() || null,
        secret: campoSecret.value,
        algorithm: $('#nova-alg').value,
        digits: Number($('#nova-digitos').value),
        period: Number($('#nova-periodo').value),
      },
    });
    // O segredo sai do DOM assim que o servidor confirma.
    campoSecret.value = '';
    $('#form-manual').reset();
    brinde('Chave cadastrada');
    ir('lista', { empilhar: false });
    pilha.length = 0;
    await carregarLista();
  } catch (erro) {
    campoSecret.value = '';
    mostrarErro('nova', erro.message);
  }
});

$('#form-uri').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  await analisar($('#uri-texto').value, 'uri');
});

// ── QR ──────────────────────────────────────────────────────────────────────

const areaQr = $('#area-qr');
$('#qr-escolher').addEventListener('click', () => $('#qr-arquivo').click());

// A câmera abre numa janela própria, e não aqui dentro, por um motivo prático:
// a caixa de permissão do Chrome tira o foco do popup, e popup sem foco fecha
// — levando junto o pedido de câmera. Ver o comentário de src/scan/scan.js.
$('#qr-camera').addEventListener('click', async () => {
  limparErro('qr');
  try {
    await pedir('abrirCamera');
    // O popup fecharia sozinho ao perder o foco de qualquer jeito; fechar
    // aqui evita o susto de ver a janela sumir "sozinha".
    window.close();
  } catch (erro) {
    mostrarErro('qr', erro.message);
  }
});
$('#qr-arquivo').addEventListener('change', (evento) => {
  const arquivo = evento.target.files?.[0];
  evento.target.value = '';
  if (arquivo) lerQr([arquivo]);
});

['dragenter', 'dragover'].forEach((tipo) => areaQr.addEventListener(tipo, (e) => { e.preventDefault(); areaQr.classList.add('sobre'); }));
['dragleave', 'drop'].forEach((tipo) => areaQr.addEventListener(tipo, (e) => { e.preventDefault(); areaQr.classList.remove('sobre'); }));
areaQr.addEventListener('drop', (evento) => {
  const arquivos = [...(evento.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (arquivos.length) lerQr(arquivos);
  else mostrarErro('qr', 'Solte um arquivo de imagem.');
});

document.addEventListener('paste', (evento) => {
  if ($('.tela:not(.oculto)')?.dataset.tela !== 'nova') return;
  if ($('[data-painel="qr"]').classList.contains('oculto')) return;
  const imagens = [...(evento.clipboardData?.items ?? [])]
    .filter((item) => item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (imagens.length) { evento.preventDefault(); lerQr(imagens); }
});

async function lerQr(arquivos) {
  limparErro('qr');
  try {
    const textos = [];
    for (const arquivo of arquivos) {
      textos.push(...await lerQrDeImagem(arquivo));
    }
    // O bitmap e o texto do QR morrem aqui: o que segue é o payload, e ele vai
    // direto para o servidor. Nada é guardado, nada é registrado.
    await analisar(juntarPayload(textos), 'qr');
  } catch (erro) {
    mostrarErro('qr', erro.message);
  }
}

// ── análise e importação ────────────────────────────────────────────────────

async function analisar(payload, chaveErro) {
  limparErro(chaveErro);
  if (!payload?.trim()) return mostrarErro(chaveErro, 'Nada para analisar.');

  try {
    const analise = await pedir('analisarImportacao', { payload });
    estado.importacao = { payload, itens: analise.items, pulados: analise.skipped };
    renderizarImportacao();
    ir('importar');
  } catch (erro) {
    mostrarErro(chaveErro, erro.message);
  }
}

function renderizarImportacao() {
  const { itens, pulados } = estado.importacao;
  $('#importar-titulo').textContent = itens.length === 1 ? '1 conta encontrada' : `${itens.length} contas encontradas`;

  const alvo = $('#importar-lista');
  alvo.replaceChildren();

  for (const item of itens) {
    const linha = document.createElement('label');
    linha.className = 'importar-item';

    const caixa = document.createElement('input');
    caixa.type = 'checkbox';
    caixa.checked = !item.duplicate;
    caixa.dataset.indice = String(item.index);

    const info = document.createElement('div');
    info.className = 'info';

    const titulo = document.createElement('div');
    titulo.className = 'titulo';
    titulo.textContent = item.name;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = [item.issuer, `${item.algorithm} · ${item.digits} dígitos · ${item.period}s`].filter(Boolean).join(' · ');

    const nomeEditavel = document.createElement('input');
    nomeEditavel.type = 'text';
    nomeEditavel.value = item.name;
    nomeEditavel.maxLength = 120;
    nomeEditavel.dataset.nomeIndice = String(item.index);
    nomeEditavel.setAttribute('aria-label', `Nome para ${item.name}`);
    nomeEditavel.addEventListener('click', (e) => e.preventDefault());

    info.append(titulo, meta, nomeEditavel);

    if (item.duplicate) {
      const dup = document.createElement('div');
      dup.className = 'dup';
      dup.textContent = `Possível duplicidade: você já tem "${item.duplicate.name}". Marque se quiser importar assim mesmo.`;
      info.append(dup);
    }

    linha.append(caixa, info);
    alvo.append(linha);
  }

  for (const pulado of pulados ?? []) {
    const linha = document.createElement('div');
    linha.className = 'importar-item';
    const info = document.createElement('div');
    info.className = 'info';
    const titulo = document.createElement('div');
    titulo.className = 'titulo titulo--apagado';
    titulo.textContent = pulado.name;
    const motivo = document.createElement('div');
    motivo.className = 'dup';
    motivo.textContent = pulado.reason;
    info.append(titulo, motivo);
    linha.append(info);
    alvo.append(linha);
  }
}

$('#importar-todas').addEventListener('click', () => $$('#importar-lista input[type=checkbox]').forEach((c) => { c.checked = true; }));
$('#importar-nenhuma').addEventListener('click', () => $$('#importar-lista input[type=checkbox]').forEach((c) => { c.checked = false; }));

$('#importar-confirmar').addEventListener('click', async () => {
  limparErro('importar');
  const marcados = $$('#importar-lista input[type=checkbox]:checked').map((c) => Number(c.dataset.indice));
  if (marcados.length === 0) return mostrarErro('importar', 'Selecione ao menos uma conta.');

  const nomes = new Map($$('#importar-lista input[data-nome-indice]').map((i) => [Number(i.dataset.nomeIndice), i.value.trim()]));
  const botaoConfirmar = $('#importar-confirmar');
  botaoConfirmar.disabled = true;
  botaoConfirmar.textContent = 'Importando…';

  try {
    const { created } = await pedir('importar', { payload: estado.importacao.payload, selecionados: marcados });

    // O nome editado é aplicado depois da criação: a análise não devolve
    // segredo, então o commit reusa o payload original.
    await Promise.all(created.map((criada, posicao) => {
      const nomeEscolhido = nomes.get(marcados[posicao]);
      if (!nomeEscolhido || nomeEscolhido === criada.name) return null;
      return pedir('atualizar', { id: criada.id, dados: { name: nomeEscolhido } }).catch(() => null);
    }).filter(Boolean));

    estado.importacao = null;
    brinde(created.length === 1 ? '1 chave importada' : `${created.length} chaves importadas`);
    pilha.length = 0;
    ir('lista', { empilhar: false });
    await carregarLista();
  } catch (erro) {
    mostrarErro('importar', erro.message);
  } finally {
    botaoConfirmar.disabled = false;
    botaoConfirmar.textContent = 'Importar selecionadas';
  }
});

// ── compartilhar ────────────────────────────────────────────────────────────

function abrirCompartilhar(id) {
  estado.compartilharId = id;
  estado.compartilharUsuario = null;
  $('#compartilhar-busca').value = '';
  $('#compartilhar-resultados').replaceChildren(vazio('Quem vai receber?', 'Digite o nome ou o e-mail de alguém do CRM.'));
  $('#compartilhar-confirmar').disabled = true;
  limparErro('compartilhar');
  ir('compartilhar');
}

let buscaTimer = null;
$('#compartilhar-busca').addEventListener('input', (evento) => {
  clearTimeout(buscaTimer);
  const termo = evento.target.value.trim();
  if (termo.length < 2) {
    $('#compartilhar-resultados').replaceChildren(vazio('Quem vai receber?', 'Digite pelo menos duas letras.'));
    return;
  }
  buscaTimer = setTimeout(async () => {
    try {
      const { users } = await pedir('buscarUsuarios', { termo });
      const alvo = $('#compartilhar-resultados');
      if (users.length === 0) {
        // Não existe "convidar por e-mail": o destino tem de ser um usuário
        // que já existe e está ativo no CRM.
        alvo.replaceChildren(vazio('Ninguém encontrado', 'Só é possível compartilhar com usuários ativos do CRM.'));
        return;
      }
      alvo.replaceChildren(...users.map((usuario) => {
        const linha = pessoa(usuario.name, usuario.email, usuario.role ?? '');
        linha.classList.add('selecionavel');
        linha.addEventListener('click', () => {
          estado.compartilharUsuario = usuario;
          $$('.pessoa.selecionavel').forEach((p) => p.classList.remove('selecionada'));
          linha.classList.add('selecionada');
          $('#compartilhar-confirmar').disabled = false;
        });
        return linha;
      }));
    } catch (erro) {
      mostrarErro('compartilhar', erro.message);
    }
  }, 220);
});

$('#compartilhar-confirmar').addEventListener('click', async () => {
  limparErro('compartilhar');
  const usuario = estado.compartilharUsuario;
  if (!usuario) return;

  const permissao = $('input[name=nivel]:checked').value;
  let token = null;

  if (permissao === 'EXPORT') {
    const confirmacao = await pedirConfirmacao({
      texto: `Conceder "exportar segredo" a ${usuario.name} é o privilégio máximo desta chave. Confirme com a sua senha do CRM.`,
      pedirMotivo: false,
    });
    if (!confirmacao) return;
    token = confirmacao.token;
  }

  try {
    await pedir('compartilhar', { id: estado.compartilharId, userId: usuario.user_id, permissao, stepUpToken: token });
    brinde(`Compartilhada com ${usuario.name}`);
    abrirDetalhe(estado.compartilharId);
  } catch (erro) {
    mostrarErro('compartilhar', erro.message);
  }
});

// ── transferência ───────────────────────────────────────────────────────────

async function abrirTransferencia(id) {
  const termo = window.prompt('Transferir para quem? Digite parte do nome ou do e-mail:');
  if (!termo) return;

  try {
    const { users } = await pedir('buscarUsuarios', { termo: termo.trim() });
    if (users.length === 0) return brinde('Ninguém encontrado com esse nome.', 'erro');
    const escolhido = users[0];
    if (!window.confirm(`Transferir a propriedade para ${escolhido.name} (${escolhido.email})?\n\nVocê continua com acesso de gerenciamento.`)) return;

    const confirmacao = await pedirConfirmacao({
      texto: `Transferir a propriedade para ${escolhido.name}. Confirme com a sua senha do CRM.`,
      pedirMotivo: true,
    });
    if (!confirmacao) return;

    await pedir('transferir', { id, novoDono: escolhido.user_id, stepUpToken: confirmacao.token, motivo: confirmacao.motivo });
    brinde('Propriedade transferida');
    abrirDetalhe(id);
  } catch (erro) {
    brinde(erro.message, 'erro');
  }
}

// ── conta e dispositivos ────────────────────────────────────────────────────

$('#abrir-dispositivos').addEventListener('click', async () => {
  ir('conta');
  const corpo = $('#conta-corpo');
  corpo.replaceChildren(Object.assign(document.createElement('div'), { className: 'esqueleto' }));

  try {
    const [perfil, { sessions }] = await Promise.all([pedir('perfil'), pedir('dispositivos')]);
    corpo.replaceChildren();

    const blocoPerfil = document.createElement('div');
    blocoPerfil.className = 'bloco';
    blocoPerfil.append(rotulo('Conta do CRM'));
    blocoPerfil.append(pessoa(perfil.user.name, perfil.user.email, perfil.user.is_admin ? 'ADMIN' : perfil.user.role ?? ''));
    corpo.append(blocoPerfil);

    const blocoSessoes = document.createElement('div');
    blocoSessoes.className = 'bloco';
    blocoSessoes.append(rotulo('Dispositivos conectados'));

    const ativas = sessions.filter((s) => !s.revoked_at);
    if (ativas.length === 0) blocoSessoes.append(vazio('Nenhum dispositivo', 'Nada conectado além deste.'));

    for (const sessao of ativas) {
      const linha = document.createElement('div');
      linha.className = 'pessoa';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = sessao.kind === 'web' ? 'CRM' : 'EXT';
      const quem = document.createElement('div');
      quem.className = 'quem';
      const b = document.createElement('b');
      b.textContent = sessao.device_name ?? 'Dispositivo';
      const small = document.createElement('small');
      small.textContent = `Último acesso: ${formatarData(sessao.last_used_at)}${sessao.is_current ? ' · este' : ''}`;
      quem.append(b, small);
      linha.append(avatar, quem);

      if (!sessao.is_current) {
        const revogar = document.createElement('button');
        revogar.className = 'link link--perigo';
        revogar.textContent = 'Revogar';
        revogar.addEventListener('click', async () => {
          try {
            await pedir('revogarDispositivo', { id: sessao.id });
            brinde('Dispositivo revogado');
            $('#abrir-dispositivos').click();
          } catch (erro) { brinde(erro.message, 'erro'); }
        });
        linha.append(revogar);
      }
      blocoSessoes.append(linha);
    }
    corpo.append(blocoSessoes);

    const blocoSeguranca = document.createElement('div');
    blocoSeguranca.className = 'bloco';
    blocoSeguranca.append(rotulo('Segurança'));
    blocoSeguranca.append(linhaInfo('PIN de segurança', perfil.admin_pin_configured ? 'Configurado' : 'Não configurado'));
    const nota = document.createElement('p');
    nota.className = 'nota nota--solta';
    nota.textContent = perfil.user.is_admin
      ? 'É o mesmo PIN do CRM, cadastrado em Meu Perfil → Segurança. Foi ele que você digitou ao ligar este dispositivo.'
      : 'Recuperação de segredo é operação administrativa e não passa por esta extensão.';
    blocoSeguranca.append(nota);
    corpo.append(blocoSeguranca);

    corpo.append(blocoDeAparencia());
    corpo.append(blocoDoCrm());
  } catch (erro) {
    corpo.replaceChildren(vazio('Não foi possível carregar', erro.message));
  }
});

/**
 * Aparência: seguir o sistema, ou não.
 *
 * O padrão continua sendo o sistema — é o que acerta sozinho para quase todo
 * mundo. Mas quem trabalha o dia inteiro num CRM claro não quer um popup preto
 * saltando na frente só porque o macOS virou o tema às 18h, e essa pessoa
 * precisa de um lugar para dizer isso.
 */
function blocoDeAparencia() {
  const bloco = document.createElement('div');
  bloco.className = 'bloco';
  bloco.append(rotulo('Aparência'));

  const seletor = document.createElement('div');
  seletor.className = 'segmentado segmentado--bloco';
  seletor.setAttribute('role', 'radiogroup');
  seletor.setAttribute('aria-label', 'Tema da extensão');

  for (const [valor, texto] of [['sistema', 'Sistema'], ['claro', 'Claro'], ['escuro', 'Escuro']]) {
    const opcao = document.createElement('button');
    opcao.type = 'button';
    opcao.textContent = texto;
    opcao.setAttribute('role', 'radio');
    opcao.classList.toggle('ativa', estado.tema === valor);
    opcao.setAttribute('aria-checked', String(estado.tema === valor));
    opcao.addEventListener('click', async () => {
      estado.tema = await salvarTema(valor);
      for (const irma of seletor.children) {
        const ativa = irma === opcao;
        irma.classList.toggle('ativa', ativa);
        irma.setAttribute('aria-checked', String(ativa));
      }
    });
    seletor.append(opcao);
  }

  bloco.append(seletor);
  const nota = document.createElement('p');
  nota.className = 'nota nota--solta';
  nota.textContent = 'Com "Sistema", a extensão acompanha o tema do seu computador.';
  bloco.append(nota);
  return bloco;
}

/**
 * A ponte para o CRM.
 *
 * O que não cabe num popup de 380px — auditoria, recuperação por administrador,
 * quem instalou a extensão em qual máquina — mora nas Configurações do CRM. Em
 * vez de repetir tudo aqui, o popup manda a pessoa direto para a aba certa
 * (`?section=authenticator`), e não para a raiz do sistema.
 *
 * Abrir aba não custa permissão nenhuma no manifest: `chrome.tabs.create` já
 * vale sem `tabs`, que serve para LER aba — coisa que esta extensão não faz.
 */
function blocoDoCrm() {
  const bloco = document.createElement('div');
  bloco.className = 'bloco';
  bloco.append(rotulo('No CRM'));

  const abrir = botao('Configurações do Authenticator', () => {
    chrome.tabs.create({ url: CRM_AUTHENTICATOR_URL });
    window.close();
  });
  abrir.append(icone('saida'));
  abrir.classList.add('botao--saida');
  bloco.append(abrir);

  const nota = document.createElement('p');
  nota.className = 'nota nota--solta';
  nota.textContent = 'Auditoria de acessos, recuperação por administrador e a lista de quem usa o cofre ficam lá.';
  bloco.append(nota);
  return bloco;
}

function formatarData(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  const hoje = new Date();
  const mesmoDia = data.toDateString() === hoje.toDateString();
  const hora = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (mesmoDia) return `hoje ${hora}`;
  return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${hora}`;
}

$('#sair').addEventListener('click', async () => {
  await pedir('sair').catch(() => null);
  estado.credenciais = [];
  estado.codigos = new Map();
  pilha.length = 0;
  clearTimeout(recargaTimer);
  ir('login', { empilhar: false });
});

// ── navegação e teclado ─────────────────────────────────────────────────────

$$('[data-voltar]').forEach((botaoVoltar) => botaoVoltar.addEventListener('click', () => {
  if (confirmacaoPendente) {
    const pendente = confirmacaoPendente;
    confirmacaoPendente = null;
    pendente.resolver(null);
  }
  voltar();
}));

function digitando(alvo) {
  return alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLSelectElement;
}

document.addEventListener('keydown', (evento) => {
  const naLista = $('.tela:not(.oculto)')?.dataset.tela === 'lista';

  if (evento.key === 'Escape') {
    if (naLista && !$('#caixa-busca').classList.contains('oculto')) return alternarBusca(false);
    if (!naLista) return voltar();
    return;
  }

  if (!naLista) return;

  // "/" abre a busca sem precisar de mouse.
  if (evento.key === '/' && !digitando(evento.target)) {
    evento.preventDefault();
    return alternarBusca(true);
  }

  // ⌘C (Ctrl+C no Windows) copia o código da linha ativa — a que está sob o
  // cursor, ou a que tem o foco. Só quando não há texto selecionado, senão
  // atrapalharia a cópia normal.
  if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'c') {
    if (digitando(evento.target)) return;
    if (!window.getSelection()?.isCollapsed) return;
    if (!estado.linhaAtiva) return;
    evento.preventDefault();
    return copiarCodigo(estado.linhaAtiva);
  }

  if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
    const linhas = $$('.item');
    if (linhas.length === 0) return;
    evento.preventDefault();
    const atual = linhas.findIndex((l) => l.dataset.id === estado.linhaAtiva);
    const passo = evento.key === 'ArrowDown' ? 1 : -1;
    const proxima = linhas[Math.min(linhas.length - 1, Math.max(0, (atual === -1 ? 0 : atual + passo)))];
    estado.linhaAtiva = proxima.dataset.id;
    proxima.focus();
    atualizarContadores();
  }
});

// ── ciclo de vida ───────────────────────────────────────────────────────────

tickTimer = setInterval(atualizarContadores, 1000);
window.addEventListener('unload', () => {
  clearInterval(tickTimer);
  clearTimeout(recargaTimer);
  clearInterval(segredoTimer);
});

iniciar();
