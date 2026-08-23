// A matriz de permissão do WhatsApp, perfil por perfil.
//
// Cada bloco abaixo é um dos perfis do modelo de acesso, e os casos são os do
// critério de aceitação: canal restrito, transferência histórica, UUID
// arbitrário, conversa irmã em outro canal, desligado com JWT vivo.
//
// O que este arquivo NÃO testa: a trava. Ela é do banco, e está na bateria SQL
// (`supabase/tests/whatsapp_permissoes.sql`). Aqui se testa o ESPELHO — que a
// tela chegue à mesma conclusão do servidor, para não oferecer botão que o
// servidor vai recusar nem esconder o que ele permitiria.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESCOPO_VAZIO,
  acaoBloqueadaPeloModo,
  acoesPermitidas,
  estadoDoEscopo,
  estouSupervisionando,
  modosDisponiveis,
  podeAceitar,
  podeAssumir,
  podeComandar,
  podeRedistribuir,
  podeResponder,
  podeTransferir,
  podeVer,
  supervisionaAlgo,
  type WaConversaResumo,
  type WaEscopo,
} from './waPermissions.ts';

const CANAL_RESTRITO = 'canal-restrito';
const CANAL_ABERTO = 'canal-aberto';
const SETOR = 'setor-trabalhista';

const EU = 'user-eu';
const OUTRO = 'user-outro';

function escopo(over: Partial<WaEscopo> = {}): WaEscopo {
  return {
    ...ESCOPO_VAZIO,
    userId: EU,
    carregado: true,
    ...over,
  };
}

function conversa(over: Partial<WaConversaResumo> = {}): WaConversaResumo {
  return {
    id: 'conv-1',
    instanceId: CANAL_RESTRITO,
    departmentId: null,
    assignedUserId: OUTRO,
    status: 'open',
    canalAberto: false,
    setorTemMembros: false,
    ...over,
  };
}

// ── Administrador ───────────────────────────────────────────────────────────

test('administrador: vê, comanda e redistribui em qualquer canal', () => {
  const e = escopo({ isAdmin: true });
  const c = conversa();
  assert.equal(podeVer(e, c), true);
  assert.equal(podeComandar(e, c), true);
  assert.equal(podeRedistribuir(e, c), true);
  assert.equal(podeTransferir(e, c), true);
});

test('administrador tomando conversa de outro é intervenção, e é permitida', () => {
  const e = escopo({ isAdmin: true });
  assert.equal(podeAssumir(e, conversa({ assignedUserId: OUTRO })), true);
});

// ── Supervisor por canal ────────────────────────────────────────────────────

test('supervisor: manda no canal que supervisiona', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  const c = conversa();
  assert.equal(podeVer(e, c), true);
  assert.equal(podeComandar(e, c), true);
  assert.equal(podeRedistribuir(e, c), true);
});

test('supervisor NÃO alcança canal fora do escopo dele', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_ABERTO], canaisMembro: [CANAL_ABERTO] });
  const c = conversa({ instanceId: CANAL_RESTRITO });
  assert.equal(podeVer(e, c), false);
  assert.equal(podeComandar(e, c), false);
  assert.equal(podeRedistribuir(e, c), false);
});

test('supervisor em "apenas acompanhar" não muda responsável, leitura nem fila', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  const c = conversa();
  assert.equal(estouSupervisionando(e, c), true);

  const a = acoesPermitidas(e, c, 'acompanhar');
  assert.equal(a.ver, true, 'acompanhar continua vendo');
  assert.equal(a.responder, false);
  assert.equal(a.assumir, false);
  assert.equal(a.marcarLida, false, 'zerar o não-lido do responsável é mexer no atendimento dele');
  assert.equal(a.devolverFila, false);
  assert.equal(a.encerrar, false);
  assert.equal(a.transferir, false);
});

test('supervisor em "responder sem assumir" responde e não mexe no resto', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  const a = acoesPermitidas(e, conversa(), 'responder');
  assert.equal(a.responder, true);
  assert.equal(a.assumir, false);
  assert.equal(a.encerrar, false);
  assert.equal(a.marcarLida, false);
});

test('os quatro modos aparecem para o supervisor, e nenhum para o atendente comum', () => {
  const sup = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  assert.deepEqual(
    modosDisponiveis(sup, conversa()),
    ['acompanhar', 'responder', 'assumir', 'redistribuir'],
  );

  const comum = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.deepEqual(modosDisponiveis(comum, conversa()), []);
  assert.equal(supervisionaAlgo(comum), false);
});

test('conversa própria não é supervisão, mesmo para quem supervisiona o canal', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  const minha = conversa({ assignedUserId: EU });
  assert.equal(estouSupervisionando(e, minha), false);
  assert.equal(acoesPermitidas(e, minha, 'acompanhar').responder, true,
    'o modo não pode algemar o dono do atendimento');
});

// ── Auxiliar autorizado (membro do canal) ───────────────────────────────────

test('auxiliar do canal: vê a fila, assume o que não tem dono, não toma o dos outros', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });

  const naFila = conversa({ assignedUserId: null });
  assert.equal(podeVer(e, naFila), true);
  assert.equal(podeAssumir(e, naFila), true);

  const deOutro = conversa({ assignedUserId: OUTRO });
  assert.equal(podeVer(e, deOutro), true, 'a fila do canal é compartilhada');
  assert.equal(podeAssumir(e, deOutro), false, 'takeover é de supervisor');
  assert.equal(podeComandar(e, deOutro), false);
  assert.equal(podeRedistribuir(e, deOutro), false);
});

test('auxiliar transfere o que é dele, e só', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeTransferir(e, conversa({ assignedUserId: EU })), true);
  assert.equal(podeTransferir(e, conversa({ assignedUserId: OUTRO })), false);
});

test('auxiliar entrega o PRÓPRIO atendimento sem aceite (a transferência na ligação)', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeRedistribuir(e, conversa({ assignedUserId: EU })), true);
  assert.equal(podeRedistribuir(e, conversa({ assignedUserId: OUTRO })), false,
    'entregar o dos outros continua sendo ato de supervisor');
});

// ── Auxiliar SEM acesso ao canal ────────────────────────────────────────────

test('auxiliar sem o canal não vê nem age — nem com uuid na mão', () => {
  const e = escopo({ canaisMembro: [CANAL_ABERTO] });
  const c = conversa({ instanceId: CANAL_RESTRITO });
  assert.equal(podeVer(e, c), false);
  assert.equal(podeComandar(e, c), false);
  assert.equal(podeResponder(e, c), false);
  assert.equal(podeTransferir(e, c), false);
  assert.equal(podeAceitar(e, c), false);

  const a = acoesPermitidas(e, c);
  assert.equal(Object.values(a).every(v => v === false), true,
    'nenhuma ação sobra para quem não tem o canal');
});

test('canal aberto (visibility_mode = all) é visto por qualquer atendente', () => {
  const e = escopo({ canaisMembro: [] });
  const c = conversa({ instanceId: CANAL_ABERTO, canalAberto: true, assignedUserId: null });
  assert.equal(podeVer(e, c), true);
  assert.equal(podeAssumir(e, c), true);
});

test('setor com membros filtra quem não pertence a ele', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO], setoresMembro: [] });
  const c = conversa({ departmentId: SETOR, setorTemMembros: true, assignedUserId: null });
  assert.equal(podeVer(e, c), false);

  const dentro = escopo({ canaisMembro: [CANAL_RESTRITO], setoresMembro: [SETOR] });
  assert.equal(podeVer(dentro, c), true);
});

// ── Destinatário de transferência ───────────────────────────────────────────

test('destino de transferência PENDENTE vê a conversa e pode aceitar', () => {
  const e = escopo({ canaisMembro: [] });   // não é do canal
  const c = conversa({ transferenciaPendenteParaMim: true });
  assert.equal(podeVer(e, c), true);
  assert.equal(podeAceitar(e, c), true);
});

test('transferência HISTÓRICA não concede nada — é o furo principal', () => {
  const e = escopo({ canaisMembro: [] });
  // Sem `transferenciaPendenteParaMim`: a transferência acabou (aceita,
  // recusada, cancelada ou expirada). Não sobra acesso nenhum.
  const c = conversa({ transferenciaPendenteParaMim: false, transferenciaPendenteMinha: false });
  assert.equal(podeVer(e, c), false);
  assert.equal(podeAceitar(e, c), false);
  assert.equal(podeResponder(e, c), false);
});

test('o destino recebe a CONVERSA, não o canal', () => {
  const e = escopo({ canaisMembro: [] });
  const transferida = conversa({ id: 'conv-1', transferenciaPendenteParaMim: true });
  const outraDoMesmoCanal = conversa({ id: 'conv-2' });

  assert.equal(podeVer(e, transferida), true);
  assert.equal(podeVer(e, outraDoMesmoCanal), false,
    'ver a conversa emprestada não abre a inbox do canal');
});

test('quem transferiu continua respondendo enquanto o aceite não vem', () => {
  const e = escopo({ canaisMembro: [] });
  const c = conversa({ assignedUserId: OUTRO, transferenciaPendenteMinha: true, awaitingAccept: true });
  assert.equal(podeVer(e, c), true);
});

// ── Colaborador temporário ──────────────────────────────────────────────────

test('colaborador responde a conversa emprestada e não comanda o atendimento', () => {
  const e = escopo({ canaisMembro: [] });
  const c = conversa({ souColaborador: true });
  assert.equal(podeVer(e, c), true);
  assert.equal(podeResponder(e, c), true);
  assert.equal(podeComandar(e, c), false, 'ajudar não é virar responsável');
  assert.equal(podeTransferir(e, c), false);
  assert.equal(acoesPermitidas(e, c).encerrar, false);
});

test('colaborador não ganha o canal junto', () => {
  const e = escopo({ canaisMembro: [] });
  assert.equal(podeVer(e, conversa({ id: 'conv-1', souColaborador: true })), true);
  assert.equal(podeVer(e, conversa({ id: 'conv-2' })), false);
});

// ── Usuário desligado / sessão sem identidade ───────────────────────────────

test('sem userId (portal, anônimo, sessão perdida) não há ação nenhuma', () => {
  const e = escopo({ userId: null, canaisMembro: [CANAL_RESTRITO] });
  const c = conversa({ assignedUserId: null });
  // Ver a fila do canal continua valendo pelo vínculo (é o servidor que corta
  // de verdade quando o perfil está inativo); agir, não.
  assert.equal(podeAssumir(e, c), false);
  assert.equal(podeAceitar(e, c), false);
});

test('desligado: o escopo volta vazio e a tela não oferece nada', () => {
  // É assim que o escopo chega depois do desligamento: `wa_offboard_user`
  // apagou os vínculos, e `is_office_staff()` já recusa o resto.
  const e = escopo({ canaisMembro: [], setoresMembro: [], canaisSupervisionados: [] });
  const c = conversa({ assignedUserId: null });
  assert.equal(podeVer(e, c), false);
  assert.equal(estadoDoEscopo(e, 2), 'sem-permissao');
});

// ── Conversas irmãs em canais diferentes ────────────────────────────────────

test('irmãs do mesmo contato em canais diferentes são julgadas uma a uma', () => {
  const e = escopo({ canaisMembro: [CANAL_ABERTO] });
  const noAberto = conversa({ id: 'irma-1', instanceId: CANAL_ABERTO, assignedUserId: null });
  const noRestrito = conversa({ id: 'irma-2', instanceId: CANAL_RESTRITO, assignedUserId: null });

  assert.equal(podeComandar(e, noAberto), true);
  assert.equal(podeComandar(e, noRestrito), false,
    'o leque por attendance_key não pode arrastar a irmã do canal restrito');
});

// ── Vazio não é proibido ────────────────────────────────────────────────────

test('carregando, sem canais e sem permissão são três estados diferentes', () => {
  assert.equal(estadoDoEscopo({ ...ESCOPO_VAZIO, carregado: false }, null), 'carregando');
  assert.equal(estadoDoEscopo({ ...ESCOPO_VAZIO, carregado: true }, null), 'carregando');
  assert.equal(estadoDoEscopo({ ...ESCOPO_VAZIO, carregado: true }, 0), 'sem-canais');
  assert.equal(estadoDoEscopo(escopo({ canaisMembro: [] }), 3), 'sem-permissao');
  assert.equal(estadoDoEscopo(escopo({ canaisMembro: [CANAL_ABERTO] }), 3), 'ok');
  assert.equal(estadoDoEscopo(escopo({ isAdmin: true, canaisMembro: [] }), 3), 'ok');
});

test('enquanto o escopo não carregou, nada é escondido e nada é comandado', () => {
  const e = { ...ESCOPO_VAZIO, userId: EU, carregado: false };
  assert.equal(podeVer(e, conversa()), true, 'esconder no boot esvaziaria a inbox de todo mundo');
  assert.equal(podeComandar(e, conversa()), false, 'na dúvida, não se age');
});

// ── O modo aperta, nunca solta ──────────────────────────────────────────────

test('o modo nunca amplia o que a permissão negou', () => {
  const semCanal = escopo({ canaisMembro: [] });
  const c = conversa();
  for (const modo of ['acompanhar', 'responder', 'assumir', 'redistribuir'] as const) {
    const a = acoesPermitidas(semCanal, c, modo);
    assert.equal(a.responder, false, `modo ${modo} não pode liberar resposta sem permissão`);
    assert.equal(a.assumir, false, `modo ${modo} não pode liberar assumir sem permissão`);
  }
});

test('a lista do que "apenas acompanhar" bloqueia é a do modelo de acesso', () => {
  for (const acao of ['responder', 'assumir', 'marcarLida', 'devolverFila', 'transferir'] as const) {
    assert.equal(acaoBloqueadaPeloModo('acompanhar', acao), true, acao);
  }
  assert.equal(acaoBloqueadaPeloModo('acompanhar', 'anotar'), false,
    'anotar é o registro do que o supervisor observou — não toca no atendimento');
});
