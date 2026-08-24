// Popup. Não tem token, não tem segredo guardado, não fala com a rede: tudo
// passa por mensagem para o service worker.
//
// Toda escrita de texto vindo do servidor usa `textContent`. Não há um único
// `innerHTML` com dado de usuário — é assim que um nome de chave com
// `<img onerror=…>` continua sendo só um nome esquisito.

import { lerQrDeImagem, juntarPayload } from '../lib/qr.js';

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

const pilha = [];

function ir(nome, { empilhar = true } = {}) {
  const atual = $('.tela:not(.oculto)')?.dataset.tela;
  if (empilhar && atual && atual !== nome) pilha.push(atual);
  $$('.tela').forEach((tela) => tela.classList.toggle('oculto', tela.dataset.tela !== nome));
  const foco = $(`[data-tela="${nome}"] input, [data-tela="${nome}"] textarea`);
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

// ── estado do popup ─────────────────────────────────────────────────────────

const estado = {
  credenciais: [],
  codigos: new Map(),      // id → { code, period, expiresAt (ms), digits }
  deltaRelogio: 0,         // servidor − navegador, em ms
  filtro: '',
  detalheId: null,
  compartilharId: null,
  compartilharUsuario: null,
  importacao: null,
};

let tickTimer = null;
let recargaTimer = null;

// ── autenticação ────────────────────────────────────────────────────────────

async function iniciar() {
  try {
    const { autenticado } = await pedir('estado');
    if (!autenticado) return ir('login', { empilhar: false });
    ir('lista', { empilhar: false });
    await carregarLista();

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
let etapaPin = false;

function irParaEtapaPin(email) {
  etapaPin = true;
  $('#login-etapa-conta').classList.add('oculto');
  $('#login-etapa-pin').classList.remove('oculto');
  $('#login-voltar').classList.remove('oculto');
  $('#login-conferido').textContent = `Entrando como ${email}`;
  $('#login-enviar').textContent = 'Entrar';
  $('#login-nota').textContent = 'O PIN é pedido uma vez, ao ligar este dispositivo. Depois a extensão não pergunta mais.';
  $('#login-pin').required = true;
  setTimeout(() => $('#login-pin').focus(), 40);
}

function voltarParaConta() {
  etapaPin = false;
  $('#login-etapa-conta').classList.remove('oculto');
  $('#login-etapa-pin').classList.add('oculto');
  $('#login-voltar').classList.add('oculto');
  $('#login-enviar').textContent = 'Continuar';
  $('#login-pin').required = false;
  $('#login-pin').value = '';
  $('#login-senha').value = '';
  limparErro('login-erro');
  setTimeout(() => $('#login-email').focus(), 40);
}

$('#login-voltar').addEventListener('click', voltarParaConta);

$('#form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limparErro('login-erro');

  const botao = $('#login-enviar');
  const campoSenha = $('#login-senha');
  const campoPin = $('#login-pin');
  const email = $('#login-email').value;

  botao.disabled = true;
  botao.textContent = etapaPin ? 'Entrando…' : 'Conferindo…';

  try {
    await pedir('entrar', {
      email,
      senha: campoSenha.value,
      // Na etapa 1 o PIN vai vazio de propósito: é o 428 do servidor que diz
      // "a senha está certa, agora peça o PIN".
      pin: etapaPin ? campoPin.value : '',
    });

    // Senha e PIN somem do DOM assim que deixam de ser necessários.
    campoSenha.value = '';
    campoPin.value = '';
    voltarParaConta();
    ir('lista', { empilhar: false });
    await carregarLista();
  } catch (erro) {
    if (erro.status === 428 && !etapaPin) {
      // Senha aceita. Só falta o PIN.
      irParaEtapaPin(email);
    } else {
      campoPin.value = '';
      if (!etapaPin) campoSenha.value = '';
      mostrarErro('login-erro', erro.message);
    }
  } finally {
    botao.disabled = false;
    botao.textContent = etapaPin ? 'Entrar' : 'Continuar';
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
    agendarRecarga();
  } catch (erro) {
    if (erro.status === 401) throw erro;
    estado.codigos = new Map();
    brinde('Cofre indisponível. Os códigos voltam quando a conexão voltar.', 'erro');
  }
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
  const visiveis = estado.credenciais
    .filter((c) => {
      if (!termo) return true;
      return semAcento(`${c.name} ${c.issuer ?? ''} ${c.account_label ?? ''}`).includes(termo);
    })
    // Favorito primeiro, e dentro de cada grupo em ordem alfabética. Quem
    // marcou uma estrela quer aquela chave à mão — não rolando a lista.
    .sort((a, b) => {
      if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
      return semAcento(a.name).localeCompare(semAcento(b.name), 'pt-BR');
    });

  if (estado.credenciais.length === 0) {
    alvo.replaceChildren(vazio('Nenhuma chave ainda', 'Cadastre a primeira em "+ Nova chave" ou importe do Google Authenticator.'));
    return;
  }
  if (visiveis.length === 0) {
    alvo.replaceChildren(vazio('Nada encontrado', `Nenhuma chave com "${estado.filtro}".`));
    return;
  }

  alvo.replaceChildren(...visiveis.map(cartao));
  atualizarContadores();
}

function cartao(credencial) {
  const item = document.createElement('div');
  item.className = 'item';
  item.dataset.id = credencial.id;

  const nome = document.createElement('div');
  nome.className = 'item-nome';

  const estrela = document.createElement('button');
  estrela.className = `item-estrela${credencial.favorite ? ' ativa' : ''}`;
  estrela.textContent = credencial.favorite ? '★' : '☆';
  estrela.title = credencial.favorite ? 'Remover dos favoritos' : 'Favoritar';
  estrela.addEventListener('click', async () => {
    try {
      await pedir('favoritar', { id: credencial.id, favorito: !credencial.favorite });
      credencial.favorite = !credencial.favorite;
      renderizarLista();
    } catch (erro) { brinde(erro.message, 'erro'); }
  });

  const texto = document.createElement('span');
  texto.textContent = credencial.name;
  texto.className = 'item-nome-texto';
  nome.append(estrela, texto);

  if (credencial.shared || !credencial.is_owner) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = credencial.is_owner ? `👥 ${credencial.shared_count}` : `👥 de ${credencial.owner_name ?? 'outro'}`;
    badge.title = credencial.is_owner ? 'Compartilhada por você' : 'Compartilhada com você';
    nome.append(badge);
  }

  const abrir = document.createElement('button');
  abrir.className = 'item-abrir';
  abrir.textContent = '›';
  abrir.title = 'Detalhes';
  abrir.setAttribute('aria-label', `Detalhes de ${credencial.name}`);
  abrir.addEventListener('click', () => abrirDetalhe(credencial.id));
  nome.append(abrir);

  const codigo = document.createElement('div');
  codigo.className = 'item-codigo';
  codigo.dataset.papel = 'codigo';

  const contador = document.createElement('div');
  contador.className = 'item-contador';
  contador.dataset.papel = 'contador';

  const copiar = document.createElement('button');
  copiar.className = 'item-copiar';
  copiar.textContent = 'COPIAR';
  copiar.dataset.papel = 'copiar';
  // Só vai para a área de transferência com clique. Não existe cópia
  // automática, nem leitura de página, nem monitoramento de formulário.
  copiar.addEventListener('click', async () => {
    const atual = estado.codigos.get(credencial.id);
    if (!atual?.code) return brinde('Código indisponível.', 'erro');
    try {
      await navigator.clipboard.writeText(atual.code);
      copiar.textContent = '✓ COPIADO';
      copiar.classList.add('copiado');
      brinde('Código copiado');
      setTimeout(() => { copiar.textContent = 'COPIAR'; copiar.classList.remove('copiado'); }, 1400);
    } catch (_) {
      brinde('O navegador bloqueou a cópia.', 'erro');
    }
  });

  const preencher = document.createElement('button');
  preencher.className = 'item-preencher';
  preencher.textContent = 'PREENCHER';
  preencher.dataset.papel = 'preencher';
  preencher.title = 'Escrever o código no campo da página aberta';
  // O popup não toca na aba: ele pede, e quem escreve é o service worker —
  // que também é quem busca um código novo, para não preencher um vencido.
  preencher.addEventListener('click', async () => {
    preencher.disabled = true;
    const antes = preencher.textContent;
    preencher.textContent = '…';
    try {
      await pedir('preencher', { id: credencial.id });
      preencher.textContent = '✓ PREENCHIDO';
      preencher.classList.add('copiado');
      brinde('Código preenchido na página');
      setTimeout(() => window.close(), 500);
    } catch (erro) {
      preencher.textContent = antes;
      brinde(erro.message, 'erro');
    } finally {
      preencher.disabled = false;
    }
  });

  const acoes = document.createElement('div');
  acoes.className = 'item-acoes';
  acoes.append(preencher, copiar);

  const barra = document.createElement('div');
  barra.className = 'item-barra';
  const preenchimento = document.createElement('span');
  preenchimento.dataset.papel = 'barra';
  preenchimento.dataset.barraDe = credencial.id;
  barra.append(preenchimento);

  item.append(nome, codigo, contador, acoes, barra);
  return item;
}

/**
 * A LARGURA DA BARRA, SEM ATRIBUTO DE ESTILO.
 *
 * A CSP da extensão é `style-src 'self'`, e ela recusa estilo inline —
 * inclusive o que é escrito por `elemento.style.width`, que era como esta
 * barra andava. O resultado era o console cheio de "Applying inline style
 * violates..." e a barra parada, porque a atribuição era simplesmente
 * bloqueada.
 *
 * Afrouxar a CSP com `unsafe-inline` resolveria numa linha e abriria a porta
 * por onde entraria estilo injetado — a mesma porta que o resto da extensão
 * mantém fechada de propósito. Uma folha ADOTADA é a saída certa: é CSSOM
 * programático, não estilo inline, então a CSP não tem o que barrar. Regra de
 * bolso: valor fixo vira classe; valor que muda a cada segundo vira regra numa
 * folha como esta.
 *
 * As larguras são acumuladas e escritas UMA vez por tique. Chamar `replaceSync`
 * por barra faria o trabalho crescer com o quadrado do número de chaves.
 */
const folhaDasBarras = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, folhaDasBarras];
const largurasDasBarras = new Map();

function marcarLarguraDaBarra(id, porcentagem) {
  const limitada = Math.min(100, Math.max(0, porcentagem));
  largurasDasBarras.set(id, limitada);
}

function aplicarLargurasDasBarras() {
  const regras = [];
  for (const [id, largura] of largurasDasBarras) {
    // `.item-barra span[...]` (0,2,1) e não `[...]` (0,1,0): o seletor tem de
    // ganhar de `.item-barra span { width: 0 }`, senão a barra nunca enche.
    regras.push(`.item-barra span[data-barra-de="${CSS.escape(id)}"]{width:${largura.toFixed(2)}%}`);
  }
  folhaDasBarras.replaceSync(regras.join('\n'));
}

/** Anima contador e barra localmente, sem ir ao servidor a cada segundo. */
function atualizarContadores() {
  const agora = Date.now() + estado.deltaRelogio;

  for (const item of $$('.item')) {
    const dados = estado.codigos.get(item.dataset.id);
    const codigo = $('[data-papel="codigo"]', item);
    const contador = $('[data-papel="contador"]', item);
    const barra = $('[data-papel="barra"]', item);
    const copiar = $('[data-papel="copiar"]', item);
    const preencher = $('[data-papel="preencher"]', item);

    if (!dados) {
      codigo.replaceChildren('······');
      contador.textContent = '';
      marcarLarguraDaBarra(item.dataset.id, 0);
      copiar.disabled = true;
      preencher.disabled = true;
      continue;
    }
    if (dados.erro) {
      codigo.replaceChildren(dados.erro);
      codigo.classList.add('indisponivel');
      contador.textContent = '';
      marcarLarguraDaBarra(item.dataset.id, 0);
      copiar.disabled = true;
      preencher.disabled = true;
      continue;
    }

    const restante = Math.max(0, Math.ceil((dados.expiraEm - agora) / 1000));
    // Dois trios em elementos separados, para o CSS controlar o respiro entre
    // eles. Um espaço solto no texto sairia com a largura da fonte mono, larga
    // demais, e é o que fazia o código parecer quebrado ao meio.
    const meio = Math.ceil(dados.code.length / 2);
    codigo.replaceChildren(...[dados.code.slice(0, meio), dados.code.slice(meio)].map((parte) => {
      const trio = document.createElement('span');
      trio.className = 'trio';
      trio.textContent = parte;
      return trio;
    }));
    codigo.classList.remove('indisponivel');
    contador.textContent = `${restante}s`;
    contador.classList.toggle('urgente', restante <= 5);
    marcarLarguraDaBarra(item.dataset.id, (restante / dados.period) * 100);
    barra.classList.toggle('urgente', restante <= 5);
    copiar.disabled = false;
    preencher.disabled = false;
  }

  aplicarLargurasDasBarras();
}

$('#busca').addEventListener('input', (evento) => {
  estado.filtro = evento.target.value;
  renderizarLista();
});

// ── detalhe ─────────────────────────────────────────────────────────────────

async function abrirDetalhe(id) {
  estado.detalheId = id;
  ir('detalhe');
  const corpo = $('#detalhe-corpo');
  corpo.replaceChildren(Object.assign(document.createElement('div'), { className: 'esqueleto' }));

  try {
    const [{ credential }, permissoes] = await Promise.all([
      pedir('detalhe', { id }),
      pedir('permissoes', { id }).catch(() => null),
    ]);

    $('#detalhe-nome').textContent = credential.name;
    corpo.replaceChildren();

    const info = document.createElement('div');
    info.className = 'bloco';
    info.append(rotulo('Identificação'));
    info.append(linhaInfo('Nome', credential.name));
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
      bloco.append(pessoa(permissoes.owner.name ?? permissoes.owner.email, permissoes.owner.email, 'OWNER'));
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
      acoes.append(botao('+ Compartilhar', () => abrirCompartilhar(id)));
      acoes.append(botao(credential.status === 'archived' ? 'Reativar' : 'Arquivar', async () => {
        try {
          await pedir('atualizar', { id, dados: { status: credential.status === 'archived' ? 'active' : 'archived' } });
          brinde(credential.status === 'archived' ? 'Chave reativada' : 'Chave arquivada');
          abrirDetalhe(id);
        } catch (erro) { brinde(erro.message, 'erro'); }
      }));
    }

    if (credential.can_export) {
      acoes.append(botao('Exportar segredo', async () => {
        const confirmacao = await pedirConfirmacao({
          texto: 'Exportar o segredo original desta chave é registrado na auditoria. Diga por que precisa dele e confirme com a sua senha.',
          pedirMotivo: true,
        });
        if (!confirmacao) return;
        try {
          const resultado = await pedir('exportar', { id, motivo: confirmacao.motivo, stepUpToken: confirmacao.token });
          mostrarSegredo(resultado);
        } catch (erro) { brinde(erro.message, 'erro'); }
      }));
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
      excluir.classList.add('botao--perigo');
      acoes.append(excluir);
    }

    corpo.append(acoes);
  } catch (erro) {
    corpo.replaceChildren(vazio('Não foi possível abrir', erro.message));
  }
}

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
  el.className = 'botao';
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

function mostrarSegredo({ secret, uri }) {
  $('#segredo-valor').textContent = secret;
  $('#segredo-uri').textContent = uri;
  ir('segredo');

  let restante = 120;
  $('#segredo-contador').textContent = restante;
  clearInterval(segredoTimer);
  segredoTimer = setInterval(() => {
    restante -= 1;
    $('#segredo-contador').textContent = Math.max(0, restante);
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

$$('.aba').forEach((aba) => {
  aba.addEventListener('click', () => {
    $$('.aba').forEach((a) => a.classList.toggle('ativa', a === aba));
    $$('[data-painel]').forEach((p) => p.classList.toggle('oculto', p.dataset.painel !== aba.dataset.aba));
  });
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
      avatar.textContent = sessao.kind === 'web' ? '🖥' : '🧩';
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
    nota.className = 'rodape-nota';
    nota.textContent = perfil.user.is_admin
      ? 'É o mesmo PIN do CRM, cadastrado em Meu Perfil → Segurança. Foi ele que você digitou ao ligar este dispositivo.'
      : 'Recuperação de segredo é operação administrativa e não passa por esta extensão.';
    blocoSeguranca.append(nota);
    corpo.append(blocoSeguranca);
  } catch (erro) {
    corpo.replaceChildren(vazio('Não foi possível carregar', erro.message));
  }
});

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

// ── navegação e ciclo de vida ───────────────────────────────────────────────

$$('[data-voltar]').forEach((botaoVoltar) => botaoVoltar.addEventListener('click', () => {
  if (confirmacaoPendente) {
    const pendente = confirmacaoPendente;
    confirmacaoPendente = null;
    pendente.resolver(null);
  }
  voltar();
}));

document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && $('.tela:not(.oculto)')?.dataset.tela !== 'lista') voltar();
});

tickTimer = setInterval(atualizarContadores, 1000);
window.addEventListener('unload', () => {
  clearInterval(tickTimer);
  clearTimeout(recargaTimer);
  clearInterval(segredoTimer);
});

iniciar();
