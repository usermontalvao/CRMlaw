// A IA da conversa: quem comanda, quem configura, e o que a faixa anuncia.
//
// Duas linhas separadas, e é o ponto do arquivo:
//
//   · CONTROLAR (pausar, retomar, limpar memória, cancelar retomada) é
//     operação de atendimento — mesma régua de assumir e encerrar;
//   · CONFIGURAR (prompt, playbook, modelo, canais, limites) é administração,
//     e vive em Configurações.
//
// Como no resto do módulo, o que se testa aqui é o ESPELHO. A trava é do banco
// — `wa_ai_require_control` e as policies `ai_sessions_*` —, e a bateria dela
// está em `supabase/tests/whatsapp_ia.sql`. Se as duas discordarem, é este
// arquivo que avisa.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESCOPO_VAZIO,
  ROTULO_ESTADO_IA,
  acaoBloqueadaPeloModo,
  acoesPermitidas,
  estadoDaIa,
  podeConfigurarIa,
  podeControlarIa,
  type WaConversaResumo,
  type WaEscopo,
  type WaIaSituacao,
} from './waPermissions.ts';

const CANAL_RESTRITO = 'canal-restrito';
const CANAL_ABERTO = 'canal-aberto';
const SETOR = 'setor-trabalhista';

const EU = 'user-eu';
const OUTRO = 'user-outro';

function escopo(over: Partial<WaEscopo> = {}): WaEscopo {
  return { ...ESCOPO_VAZIO, userId: EU, carregado: true, ...over };
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

function situacao(over: Partial<WaIaSituacao> = {}): WaIaSituacao {
  return {
    temAgente: true,
    canalLigado: true,
    iaAtiva: true,
    ultimaExecucaoFalhou: false,
    temResponsavel: false,
    aguardandoAceite: false,
    ...over,
  };
}

// ── Configurar: administrador, e só ─────────────────────────────────────────

test('configurar a IA é do administrador', () => {
  assert.equal(podeConfigurarIa(escopo({ isAdmin: true })), true);
});

test('supervisor de canal NÃO configura a IA', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeConfigurarIa(e), false,
    'supervisionar é intervir no atendimento, não editar prompt do escritório');
});

test('atendente comum NÃO configura a IA', () => {
  assert.equal(podeConfigurarIa(escopo({ canaisMembro: [CANAL_RESTRITO] })), false);
});

test('enquanto o escopo não carregou, ninguém configura', () => {
  assert.equal(podeConfigurarIa({ ...ESCOPO_VAZIO, isAdmin: true, carregado: false }), false,
    'na dúvida o editor não aparece — mostrar e depois esconder é pior que esperar');
});

// ── Controlar: o responsável, o supervisor daquele canal, o administrador ───

test('o responsável controla a IA da própria conversa', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeControlarIa(e, conversa({ assignedUserId: EU })), true);
});

test('administrador controla a IA em qualquer canal', () => {
  assert.equal(podeControlarIa(escopo({ isAdmin: true }), conversa()), true);
});

test('supervisor controla a IA dentro do escopo dele', () => {
  const dentro = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeControlarIa(dentro, conversa()), true);
});

test('supervisor NÃO controla a IA fora do escopo dele', () => {
  const fora = escopo({ canaisSupervisionados: [CANAL_ABERTO], canaisMembro: [CANAL_ABERTO] });
  assert.equal(podeControlarIa(fora, conversa()), false,
    'supervisionar um canal não dá comando no atendimento de outro');
});

test('supervisor de SETOR controla dentro do setor dele, e não fora', () => {
  const e = escopo({ setoresSupervisionados: [SETOR], setoresMembro: [SETOR] });
  assert.equal(podeControlarIa(e, conversa({ departmentId: SETOR, setorTemMembros: true })), true);
  assert.equal(podeControlarIa(e, conversa({ departmentId: 'outro-setor', setorTemMembros: true })), false);
});

test('atendente comum NÃO controla a IA da conversa de outra pessoa', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeControlarIa(e, conversa({ assignedUserId: OUTRO })), false,
    'ver o atendimento do colega não é poder calar o agente nele');
});

test('conversa sem dono é da fila: quem a enxerga controla a IA dela', () => {
  const e = escopo({ canaisMembro: [CANAL_RESTRITO] });
  assert.equal(podeControlarIa(e, conversa({ assignedUserId: null })), true);
});

test('quem não tem o canal não controla — nem enxerga', () => {
  const e = escopo({ canaisMembro: [CANAL_ABERTO] });
  assert.equal(podeControlarIa(e, conversa({ assignedUserId: null })), false);
});

test('colaborador emprestado responde, mas não comanda a IA', () => {
  const e = escopo({ canaisMembro: [] });
  const c = conversa({ souColaborador: true });
  assert.equal(podeControlarIa(e, c), false,
    'foi chamado para ajudar num caso, não para decidir como o caso é atendido');
});

test('usuário desligado (escopo vazio) não controla nem configura', () => {
  // O desligamento verdadeiro é do banco: `is_office_staff()` passou a exigir
  // `is_active`, e `wa_is_admin` também. Na tela, o efeito é um escopo sem
  // canal, sem setor e sem admin — e é isso que se confere aqui.
  const desligado = escopo({ isAdmin: false, canaisMembro: [], setoresMembro: [] });
  assert.equal(podeControlarIa(desligado, conversa({ assignedUserId: null })), false);
  assert.equal(podeConfigurarIa(desligado), false);
});

// ── O modo de supervisão aperta o controle da IA ────────────────────────────

test('"apenas acompanhar" não pausa a IA de ninguém', () => {
  assert.equal(acaoBloqueadaPeloModo('acompanhar', 'controlarIa'), true);
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  assert.equal(acoesPermitidas(e, conversa(), 'acompanhar').controlarIa, false,
    'olhar não pode mexer — é a razão de o modo existir');
});

test('a partir de "responder", o supervisor controla a IA', () => {
  const e = escopo({ canaisSupervisionados: [CANAL_RESTRITO], canaisMembro: [CANAL_RESTRITO] });
  for (const modo of ['responder', 'assumir', 'redistribuir'] as const) {
    assert.equal(acoesPermitidas(e, conversa(), modo).controlarIa, true, modo);
  }
});

test('o modo não libera o controle para quem não tem permissão', () => {
  const semCanal = escopo({ canaisMembro: [] });
  for (const modo of ['acompanhar', 'responder', 'assumir', 'redistribuir'] as const) {
    assert.equal(acoesPermitidas(semCanal, conversa(), modo).controlarIa, false, modo);
  }
});

// ── Os estados que a faixa precisa separar ──────────────────────────────────

test('sem agente vinculado, a faixa não existe', () => {
  assert.equal(estadoDaIa(situacao({ temAgente: false })), 'sem-ia');
  assert.equal(ROTULO_ESTADO_IA['sem-ia'], null);
});

test('IA pausada, falha da IA, transferência pendente e humano são quatro coisas', () => {
  assert.equal(estadoDaIa(situacao()), 'ia-ativa');
  assert.equal(estadoDaIa(situacao({ ultimaExecucaoFalhou: true })), 'ia-falha');
  assert.equal(estadoDaIa(situacao({ iaAtiva: false })), 'ia-pausada');
  assert.equal(estadoDaIa(situacao({ iaAtiva: false, temResponsavel: true })), 'atendimento-humano');
  assert.equal(estadoDaIa(situacao({ aguardandoAceite: true })), 'transferencia-pendente');

  const rotulos = new Set(
    (['ia-ativa', 'ia-falha', 'ia-pausada', 'atendimento-humano', 'transferencia-pendente'] as const)
      .map(k => ROTULO_ESTADO_IA[k]!.label));
  assert.equal(rotulos.size, 5, 'cada estado precisa de um texto próprio na tela');
});

test('canal com a IA desligada vence o estado da sessão', () => {
  assert.equal(estadoDaIa(situacao({ canalLigado: false, iaAtiva: true })), 'canal-desligado',
    'a sessão pode dizer ativa; se o canal está desligado, nenhum turno roda');
});

test('transferência pendente vem antes de tudo que não seja o canal', () => {
  assert.equal(
    estadoDaIa(situacao({ aguardandoAceite: true, iaAtiva: false, temResponsavel: true })),
    'transferencia-pendente',
    'o que a tela precisa dizer é que alguém tem de aceitar');
});

test('falha só aparece enquanto a IA está ativa', () => {
  assert.equal(
    estadoDaIa(situacao({ iaAtiva: false, ultimaExecucaoFalhou: true })),
    'ia-pausada',
    'erro de uma execução antiga não pode fazer a conversa pausada parecer quebrada');
});
