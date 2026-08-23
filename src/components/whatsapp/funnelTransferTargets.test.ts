/**
 * As regras de destino da transferência automática do funil.
 *
 * Estes casos são o espelho de `wa_funnel_destination_can_receive` e do trigger
 * `wa_funnel_entry_actions_check` (migration 20260822100000). Quando um dos dois
 * lados mudar, é aqui que a divergência aparece — a cópia é proposital e este
 * arquivo é a vigia dela.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIAVEIS_AVISO_CLIENTE, VARIAVEIS_OBSERVACAO_INTERNA,
  escreveDestino, filtraDestinos, insereVariavel, leDestino,
  opcoesDePessoa, opcoesDeSetor, previaComExemplos, resolveDestino, tokensConhecidos,
  type FontesDeDestino,
} from './funnelTransferTargets.ts';

// ── Cenário-base ────────────────────────────────────────────────────────────
//
// Dois canais: `canal-trabalhista` é restrito (só quem está em
// whatsapp_channel_members o enxerga) e `canal-aberto` é `visibility_mode: all`.

const LISLIANDRA = 'user-lisliandra';
const PEDRO = 'user-pedro';
const ADMIN = 'user-admin';
const DE_FORA = 'user-de-fora';

const fontesBase = (patch: Partial<FontesDeDestino> = {}): FontesDeDestino => ({
  canal: { id: 'canal-trabalhista', visibility_mode: 'restricted' },
  setores: [
    { id: 'setor-atendimento', name: 'Atendimento', is_active: true },
    { id: 'setor-comercial', name: 'Comercial', is_active: true },
    { id: 'setor-arquivado', name: 'Cobrança antiga', is_active: false },
    { id: 'setor-vazio', name: 'Sem ninguém', is_active: true },
  ],
  pessoas: [
    { user_id: LISLIANDRA, name: 'Lisliandra Cerqueira', role: 'Advogado' },
    { user_id: PEDRO, name: 'Pedro Montalvão', role: 'Advogado' },
    { user_id: ADMIN, name: 'Ana Administradora', role: 'Administrador' },
    { user_id: DE_FORA, name: 'Zulmira de Outro Canal', role: 'Auxiliar' },
  ],
  membrosPorSetor: {
    'setor-atendimento': [LISLIANDRA, PEDRO],
    'setor-comercial': [PEDRO],
    'setor-arquivado': [PEDRO],
    'setor-vazio': [],
  },
  membrosDoCanal: [LISLIANDRA, PEDRO],
  ...patch,
});

const transferencia = (patch: Record<string, unknown> = {}) => ({
  type: 'transfer_to_department' as const,
  message: 'Aguarde um instante, estamos encaminhando seu atendimento para o setor {{setor}}.',
  ...patch,
});

// ── 1. Seleção de setor ─────────────────────────────────────────────────────

test('a lista de setores sai do cadastro, com nome legível e id estável', () => {
  const opcoes = opcoesDeSetor(fontesBase());
  assert.deepEqual(
    opcoes.map(o => o.name),
    ['Atendimento', 'Cobrança antiga', 'Comercial', 'Sem ninguém'],
  );
  const atendimento = opcoes.find(o => o.name === 'Atendimento');
  assert.equal(atendimento?.id, 'setor-atendimento');
  assert.equal(atendimento?.indisponivel, null);
  assert.equal(atendimento?.detail, '2 atendentes');
});

test('escolher "Atendimento" grava o id, o tipo e o nome de retrato', () => {
  const opcao = opcoesDeSetor(fontesBase()).find(o => o.name === 'Atendimento')!;
  const acao = escreveDestino(transferencia(), {
    kind: opcao.kind, id: opcao.id, nome: opcao.name,
  });
  assert.equal(acao.type, 'transfer_to_department');
  assert.equal(acao.destination_type, 'department');
  assert.equal(acao.destination_id, 'setor-atendimento');
  assert.equal(acao.destination_name, 'Atendimento');
  // O espelho legado continua preenchido: leitores antigos leem `target`.
  assert.equal(acao.target, 'setor-atendimento');
});

test('setor sem nenhum atendente aparece na lista, mas não pode receber', () => {
  const vazio = opcoesDeSetor(fontesBase()).find(o => o.id === 'setor-vazio');
  assert.equal(vazio?.indisponivel, 'sem-membros');
});

// ── 2. Seleção de pessoa ────────────────────────────────────────────────────

test('a lista de pessoas sai do cadastro e vem ordenada pelo nome', () => {
  const opcoes = opcoesDePessoa(fontesBase());
  assert.deepEqual(
    opcoes.map(o => o.name),
    ['Ana Administradora', 'Lisliandra Cerqueira', 'Pedro Montalvão', 'Zulmira de Outro Canal'],
  );
});

test('escolher "Lisliandra Cerqueira" grava user_id, não nome digitado', () => {
  const opcao = opcoesDePessoa(fontesBase()).find(o => o.name === 'Lisliandra Cerqueira')!;
  const acao = escreveDestino(transferencia({ type: 'transfer_to_user' }), {
    kind: opcao.kind, id: opcao.id, nome: opcao.name,
  });
  assert.equal(acao.type, 'transfer_to_user');
  assert.equal(acao.destination_type, 'user');
  assert.equal(acao.destination_id, LISLIANDRA);
  assert.equal(acao.destination_name, 'Lisliandra Cerqueira');
  assert.equal(acao.target, LISLIANDRA);
});

// ── 3. Permissão: canal restrito, canal aberto, administrador ───────────────

test('quem não é membro do canal restrito não pode receber a transferência', () => {
  const opcoes = opcoesDePessoa(fontesBase());
  const zulmira = opcoes.find(o => o.id === DE_FORA);
  assert.equal(zulmira?.indisponivel, 'sem-acesso-ao-canal');
  const lisliandra = opcoes.find(o => o.id === LISLIANDRA);
  assert.equal(lisliandra?.indisponivel, null);
});

test('administrador enxerga qualquer canal, mesmo sem vínculo', () => {
  const ana = opcoesDePessoa(fontesBase()).find(o => o.id === ADMIN);
  assert.equal(ana?.indisponivel, null);
});

test('canal aberto (visibility_mode all) libera o escritório inteiro', () => {
  const opcoes = opcoesDePessoa(fontesBase({
    canal: { id: 'canal-aberto', visibility_mode: 'all' },
    membrosDoCanal: [],
  }));
  assert.deepEqual(opcoes.filter(o => o.indisponivel).map(o => o.name), []);
});

test('isolamento entre canais: o mesmo cadastro muda de resposta conforme o canal', () => {
  const noTrabalhista = opcoesDePessoa(fontesBase()).find(o => o.id === DE_FORA);
  const noOutro = opcoesDePessoa(fontesBase({
    canal: { id: 'canal-comercial', visibility_mode: 'restricted' },
    membrosDoCanal: [DE_FORA],
  })).find(o => o.id === DE_FORA);
  assert.equal(noTrabalhista?.indisponivel, 'sem-acesso-ao-canal');
  assert.equal(noOutro?.indisponivel, null);
});

// ── 4. Editar uma ação existente ────────────────────────────────────────────

test('reabrir a ação resolve o id salvo e mostra o nome atual do cadastro', () => {
  const acao = escreveDestino(transferencia(), {
    kind: 'department', id: 'setor-atendimento', nome: 'Nome velho do setor',
  });
  const resolucao = resolveDestino(acao, fontesBase());
  assert.equal(resolucao.status, 'ok');
  assert.equal(resolucao.id, 'setor-atendimento');
  // O nome vem do cadastro, não do retrato: setor renomeado aparece renomeado.
  assert.equal(resolucao.nome, 'Atendimento');
  assert.equal(resolucao.aviso, null);
});

test('ação salva no formato antigo (só `target`) continua sendo lida', () => {
  const antiga = { type: 'transfer_to_user' as const, target: PEDRO, message: null };
  assert.deepEqual(leDestino(antiga), { kind: 'user', id: PEDRO, nome: null });
  const resolucao = resolveDestino(antiga, fontesBase());
  assert.equal(resolucao.status, 'ok');
  assert.equal(resolucao.nome, 'Pedro Montalvão');
});

test('a seleção é mantida entre edições enquanto o registro continuar válido', () => {
  const acao = escreveDestino(transferencia(), {
    kind: 'department', id: 'setor-comercial', nome: 'Comercial',
  });
  const reescrita = escreveDestino({ ...acao, message: 'Outro texto' }, leDestino(acao));
  assert.equal(reescrita.destination_id, 'setor-comercial');
  assert.equal(resolveDestino(reescrita, fontesBase()).status, 'ok');
});

// ── 5. Destino inativo, removido ou sem permissão ───────────────────────────

test('destino desativado é sinalizado e NÃO é substituído em silêncio', () => {
  const acao = escreveDestino(transferencia(), {
    kind: 'department', id: 'setor-arquivado', nome: 'Cobrança antiga',
  });
  const resolucao = resolveDestino(acao, fontesBase());
  assert.equal(resolucao.status, 'indisponivel');
  assert.equal(resolucao.motivo, 'inativo');
  assert.equal(resolucao.id, 'setor-arquivado');   // o destino salvo continua lá
  assert.match(resolucao.aviso || '', /Cobrança antiga/);
});

test('destino excluído do cadastro é reportado pelo nome de retrato', () => {
  const acao = escreveDestino(transferencia(), {
    kind: 'department', id: 'setor-que-sumiu', nome: 'Financeiro',
  });
  const resolucao = resolveDestino(acao, fontesBase());
  assert.equal(resolucao.status, 'sumiu');
  assert.equal(resolucao.id, 'setor-que-sumiu');
  assert.match(resolucao.aviso || '', /Financeiro/);
});

test('pessoa sem acesso ao canal é recusada com o motivo certo', () => {
  const acao = escreveDestino(transferencia({ type: 'transfer_to_user' }), {
    kind: 'user', id: DE_FORA, nome: 'Zulmira de Outro Canal',
  });
  const resolucao = resolveDestino(acao, fontesBase());
  assert.equal(resolucao.status, 'indisponivel');
  assert.equal(resolucao.motivo, 'sem-acesso-ao-canal');
  assert.match(resolucao.aviso || '', /sem acesso a este canal/i);
});

test('ação sem destino nenhum é "vazio", e não erro', () => {
  const resolucao = resolveDestino(escreveDestino(transferencia(), { kind: 'department' }), fontesBase());
  assert.equal(resolucao.status, 'vazio');
  assert.equal(resolucao.aviso, null);
});

// ── 6. Pesquisa pelo nome ───────────────────────────────────────────────────

test('a pesquisa ignora acento e caixa', () => {
  const opcoes = opcoesDePessoa(fontesBase());
  assert.deepEqual(filtraDestinos(opcoes, 'MONTALVAO').map(o => o.name), ['Pedro Montalvão']);
  assert.deepEqual(filtraDestinos(opcoes, 'cerqueira').map(o => o.name), ['Lisliandra Cerqueira']);
});

test('a pesquisa aceita termos soltos e devolve tudo quando está vazia', () => {
  const opcoes = opcoesDeSetor(fontesBase());
  assert.deepEqual(filtraDestinos(opcoes, 'cobranca antiga').map(o => o.id), ['setor-arquivado']);
  assert.equal(filtraDestinos(opcoes, '   ').length, opcoes.length);
});

// ── 7. Variáveis clicáveis ──────────────────────────────────────────────────

test('o chip insere o token na posição do cursor, não no fim do texto', () => {
  const texto = 'Olá, tudo bem?';
  // Cursor logo depois de "Olá", antes da vírgula.
  const { texto: resultado, cursor } = insereVariavel(texto, 3, 3, '{{cliente.nome}}');
  assert.equal(resultado, 'Olá {{cliente.nome}}, tudo bem?');
  // O cursor para logo após o token, pronto para continuar a frase.
  assert.equal(resultado.slice(0, cursor), 'Olá {{cliente.nome}}');
});

test('a pontuação em volta não ganha espaço sobrando', () => {
  // Cursor DEPOIS da vírgula: o espaço entra antes do token, não entre a
  // palavra e a vírgula.
  const { texto } = insereVariavel('Olá, tudo bem?', 4, 4, '{{cliente.nome}}');
  assert.equal(texto, 'Olá, {{cliente.nome}} tudo bem?');
});

test('o chip substitui a seleção quando há uma', () => {
  const { texto } = insereVariavel('para o setor XXXX.', 13, 17, '{{setor}}');
  assert.equal(texto, 'para o setor {{setor}}.');
});

test('inserir no texto vazio não cria espaço sobrando', () => {
  assert.equal(insereVariavel('', 0, 0, '{{setor}}').texto, '{{setor}}');
});

test('todo chip ofertado usa um token que a execução sabe resolver', () => {
  // A execução (funnelStageActions.ts) monta o mapa com estas chaves; um chip
  // fora da lista viraria string vazia na frase enviada ao cliente.
  const resolvidosNaExecucao = new Set([
    'cliente.nome', 'cliente.primeiro_nome', 'cliente.primeiro_nome_com_virgula',
    'cliente.telefone', 'agente.nome', 'agente.primeiro_nome',
    'destino', 'setor', 'setor.origem', 'etapa.nome', 'canal.nome',
  ]);
  for (const token of tokensConhecidos()) {
    assert.ok(resolvidosNaExecucao.has(token), `token sem resolução na execução: ${token}`);
  }
});

test('o aviso ao cliente não oferece o telefone; a observação interna oferece', () => {
  assert.ok(!VARIAVEIS_AVISO_CLIENTE.some(v => v.token === '{{cliente.telefone}}'));
  assert.ok(VARIAVEIS_OBSERVACAO_INTERNA.some(v => v.token === '{{cliente.telefone}}'));
});

test('a prévia usa o destino REAL quando ele já foi escolhido', () => {
  assert.equal(
    previaComExemplos('para o setor {{setor}}.', VARIAVEIS_AVISO_CLIENTE, { setor: 'Jurídico' }),
    'para o setor Jurídico.',
  );
});

test('com destino Pessoa, a prévia mostra {{setor}} vazio, como na execução', () => {
  assert.equal(
    previaComExemplos('para {{destino}}, do setor {{setor}}.', VARIAVEIS_AVISO_CLIENTE,
      { destino: 'Lisliandra Cerqueira', setor: '' }),
    'para Lisliandra Cerqueira, do setor .',
  );
});

test('a prévia mostra o texto com exemplos e deixa o token errado à vista', () => {
  assert.equal(
    previaComExemplos('Encaminhando para o setor {{setor}}.'),
    'Encaminhando para o setor Atendimento.',
  );
  assert.equal(
    previaComExemplos('Encaminhando para o setor {{setorr}}.'),
    'Encaminhando para o setor {{setorr}}.',
  );
});
