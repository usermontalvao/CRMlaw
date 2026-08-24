import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsUsedInPrompt } from './waAiActionCatalog.ts';
import { readFileSync } from 'node:fs';
import {
  WA_AI_CONTEXT_CONTA_BLOQUEADA,
  WA_AI_CONTEXT_SEM_REGISTRO,
  WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  buildWaAiTriageConversationSchema,
  buildWaAiTriageExtractionSchema,
  buildWaAiTriageSchema,
  computeWaAiTriageNextAction,
  computeWaAiTriageProgress,
  evaluateWaAiCuts,
  normalizeWaAiPlaybook,
  normalizeWaAiPlaybookValue,
  resolveWaAiPlaybookBindings,
  waAiDateSaidByCustomer,
  waAiPlaybookField,
  waAiPlaybookFieldKeys,
  waAiPlaybookInstructions,
  waAiPlaybookPromptBlock,
  type WaAiPlaybook,
  waAiPlaybookOnlyWhenSatisfied,
} from './waAiPlaybook.ts';

// ── A cópia dupla ───────────────────────────────────────────────────────────

test('wa-ai-playbook.ts é cópia byte a byte de waAiPlaybook.ts', () => {
  const src = readFileSync(new URL('./waAiPlaybook.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-playbook.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-playbook.ts divergiu de waAiPlaybook.ts — copie o arquivo inteiro');
});

const ROTEIRO = WA_AI_PLAYBOOK_SEM_REGISTRO;
const HOJE = new Date('2026-08-12T15:00:00Z');
const TZ = 'America/Cuiaba';

const progresso = (facts: Record<string, unknown>, now: Date = HOJE) =>
  computeWaAiTriageProgress({ playbook: ROTEIRO, facts, now, timeZone: TZ });

test('campanha de conta nasce completa a partir do contexto colado no editor', () => {
  const normalized = normalizeWaAiPlaybook(WA_AI_CONTEXT_CONTA_BLOQUEADA);
  assert.equal(normalized?.id, 'bloqueio_encerramento_conta');
  assert.equal(normalized?.fields.length, 28);
  assert.equal(normalized?.stages.length, 6);
  assert.equal(normalized?.cuts.length, 7);
  assert.deepEqual((normalized?.bindings ?? []).map(item => item.key),
    ['modelo_kit_consumidor', 'destino_declaracao_residencia', 'destino_pos_assinatura']);
  assert.deepEqual(normalized?.fields.map(field => field.key),
    WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields.map(field => field.key));
});

test('saudação não fecha o nome e a campanha pergunta o nome antes do banco', () => {
  const nome = waAiPlaybookField(WA_AI_PLAYBOOK_CONTA_BLOQUEADA, 'nome')!;
  assert.equal(normalizeWaAiPlaybookValue(nome, 'Oi'), '');
  assert.equal(normalizeWaAiPlaybookValue(nome, 'Olá, tudo bem?'), '');
  assert.equal(normalizeWaAiPlaybookValue(nome, 'Igor Alvino'), 'Igor Alvino');

  const progress = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { nome: 'Oi', tipo_atendimento: 'conta_bloqueada_ou_encerrada' },
    now: HOJE, timeZone: TZ,
  });
  const action = computeWaAiTriageNextAction(WA_AI_PLAYBOOK_CONTA_BLOQUEADA, progress);
  assert.equal(progress.nextField, 'nome');
  assert.equal(action.type, 'ask_field');
  assert.equal(action.type === 'ask_field' ? action.field : '', 'nome');
  assert.match(action.type === 'ask_field' ? action.question : '', /qual é o seu nome/i);
});

test('ano recente sem mês é aceito; somente o ano na fronteira pede o mês', () => {
  const recentFacts = {
    nome: 'Igor', tipo_atendimento: 'conta_bloqueada_ou_encerrada', banco_reu: 'Neon',
    tipo_ocorrencia: 'encerramento', data_ocorrencia: '2026',
  };
  const recent = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA, facts: recentFacts, now: HOJE, timeZone: TZ,
  });
  assert.equal(recent.nextField, 'recebeu_comunicacao');

  const boundary = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { ...recentFacts, data_ocorrencia: '2024' }, now: HOJE, timeZone: TZ,
  });
  const action = computeWaAiTriageNextAction(
    WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    boundary,
    'Olha, o mês eu não me recordo, mas foi em 2024.',
  );
  assert.equal(boundary.nextField, 'data_ocorrencia');
  assert.equal(action.type, 'ask_field');
  const question = action.type === 'ask_field' ? action.question : '';
  assert.match(question, /Entendi que foi em 2024/);
  assert.match(question, /qual mês/i);
  assert.doesNotMatch(question, /^Em que mês e ano isso aconteceu\?$/);

  const block = waAiPlaybookPromptBlock(WA_AI_PLAYBOOK_CONTA_BLOQUEADA, boundary, action);
  assert.match(block, /Entendi que foi em 2024/);
  assert.doesNotMatch(block, /"Em que mês e ano isso aconteceu\?"/);

  const old = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { ...recentFacts, data_ocorrencia: '2020' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(old.cut?.id, 'prazo_2_anos_conta');
});

test('prazo da conta é calculado em tempo real e não pelo conhecimento do modelo', () => {
  const old = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { data_ocorrencia: '07/2024' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(old.cut?.id, 'prazo_2_anos_conta');
  const recent = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { data_ocorrencia: '09/2024' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(recent.cut, null);
});

test('instruções da conta informam viabilidade, explicam 40% e seguem para os documentos', () => {
  const text = waAiPlaybookInstructions(WA_AI_PLAYBOOK_CONTA_BLOQUEADA);
  assert.match(text, /40% sobre o êxito/);
  assert.match(text, /possui viabilidade jurídica/);
  assert.match(text, /não é garantia de resultado/i);
  assert.match(text, /Não diga ao cliente que a qualificação, a triagem ou uma etapa foi concluída/);
  assert.match(text, /Acolher a objeção/);
  // A escada documental inteira precisa estar escrita para o modelo, porque é
  // ele quem escreve as mensagens de cada degrau — mesmo sem decidir nenhum.
  assert.match(text, /comprovante de residência/i);
  assert.match(text, /KIT CONSUMIDOR/);
  assert.match(text, /campo Réu/);
  assert.match(text, /ação=consultar_assinatura\(\)/);
  // O vínculo já chega resolvido no destino que o escritório escolheu.
  assert.match(text, /ação=transferir\(Atendimento\)/);
  assert.doesNotMatch(text, /\{\{destino_pos_assinatura\}\}/);
  assert.doesNotMatch(text, /A qualificação foi concluída/);
  // O aceite dos honorários não é mais o fim da conversa.
  assert.doesNotMatch(text, /transfira imediatamente/i);
});

test('outro assunto jurídico troca de rota, coleta o mínimo e não herda cortes da conta', () => {
  const base = {
    nome: 'Igor', tipo_atendimento: 'outro_assunto_juridico',
    // Fatos antigos não podem cortar a nova rota.
    data_ocorrencia: '01/2020', tem_print: 'não',
  };
  const pending = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA, facts: base, now: HOJE, timeZone: TZ,
  });
  assert.equal(pending.cut, null);
  assert.equal(pending.stage, 'outro_assunto_juridico');
  assert.deepEqual(pending.missing, [
    'assunto_juridico_relato', 'assunto_juridico_periodo',
    'assunto_juridico_envolvidos', 'assunto_juridico_objetivo',
  ]);
  assert.ok(!pending.missing.includes('banco_reu'));
  assert.ok(!pending.missing.includes('aceita_honorarios'));

  const done = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: {
      ...base,
      assunto_juridico_relato: 'Fui demitido e não recebi as verbas.',
      assunto_juridico_periodo: 'Julho de 2026',
      assunto_juridico_envolvidos: 'Empresa Exemplo Ltda.',
      assunto_juridico_objetivo: 'Quero saber como cobrar o que ficou pendente.',
    },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(done.complete, true);
  assert.deepEqual(done.pending, []);
});

test('assunto sem relevância jurídica encerra sem coletar dados', () => {
  const progress = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { nome: 'Igor', tipo_atendimento: 'sem_relevancia_juridica' },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(progress.cut?.id, 'assunto_sem_relevancia_juridica');
  assert.equal(progress.cut?.effect, 'disqualify');
  assert.deepEqual(progress.pending, []);
});

test('os honorários vêm depois dos fatos, e a residência depois dos honorários', () => {
  // A ordem é a regra comercial: ninguém entrega comprovante de residência
  // antes de saber quanto vai pagar, e o escritório não monta pasta de
  // documentos de quem ainda não aceitou os honorários.
  const stages = WA_AI_PLAYBOOK_CONTA_BLOQUEADA.stages.map(stage => stage.id);
  assert.ok(stages.indexOf('honorarios') > stages.indexOf('conta'));
  assert.ok(stages.indexOf('residencia') > stages.indexOf('honorarios'));
  const field = WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields.find(item => item.key === 'aceita_honorarios');
  assert.match(String(field?.question), /possui viabilidade jurídica/);
  assert.match(String(field?.question), /somente sobre o valor que você efetivamente receber/);
  assert.doesNotMatch(String(field?.question), /A qualificação foi concluída/);
});

test('o roteiro habilita sozinho toda ação que a escada documental precisa', () => {
  // `effectiveAllowedActions` liga no turno as ações escritas como
  // `ação=nome(...)` no roteiro. Uma que o fechamento executa mas não escreve
  // fica desligada em silêncio: a escada simplesmente não anda, sem erro
  // nenhum no log. Cada degrau tem de aparecer aqui.
  const usadas = actionsUsedInPrompt(waAiPlaybookInstructions(WA_AI_PLAYBOOK_CONTA_BLOQUEADA));
  for (const acao of ['solicitar_documentos', 'consultar_documentos', 'enviar_documento',
    'consultar_assinatura', 'transferir_atendimento', 'transferir_para_humano']) {
    assert.ok(usadas.includes(acao), `o roteiro executa ${acao} mas não a declara`);
  }
});

test('o aceite dos honorários fecha a coleta: a residência não é mais perguntada antes', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const base = {
    nome: 'Ana', tipo_atendimento: 'conta_bloqueada_ou_encerrada', banco_reu: 'Banco X',
    tipo_ocorrencia: 'encerramento', data_ocorrencia: '01/2026', recebeu_comunicacao: 'não',
    motivo_informado: 'não informou', situacao_atual: 'encerrada', saldo_retido: 'não',
    agencia: 'não informado', conta: 'não informado', tem_print: 'sim', aceita_honorarios: 'sim',
  };

  // Nada a perguntar: os documentos são pedidos e a rota fica para o arquivo.
  const depoisDoAceite = computeWaAiTriageProgress({ playbook, facts: base, now: HOJE, timeZone: TZ });
  assert.equal(depoisDoAceite.complete, true);
  assert.deepEqual(depoisDoAceite.missing, []);

  // Comprovante no nome do próprio cliente: segue sem reabrir nada.
  const confere = computeWaAiTriageProgress({
    playbook, facts: { ...base, comprovante_titularidade: 'proprio' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(confere.complete, true);
});

test('comprovante em outro nome reabre a triagem, e cada rota abre o que exige', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const base = {
    nome: 'Ana', tipo_atendimento: 'conta_bloqueada_ou_encerrada', banco_reu: 'Banco X',
    tipo_ocorrencia: 'encerramento', data_ocorrencia: '01/2026', recebeu_comunicacao: 'não',
    motivo_informado: 'não informou', situacao_atual: 'encerrada', saldo_retido: 'não',
    agencia: 'não informado', conta: 'não informado', tem_print: 'sim', aceita_honorarios: 'sim',
    // Escrito pelo BACKEND ao ler o nome no arquivo, nunca perguntado.
    comprovante_titularidade: 'terceiro',
  };

  const reaberto = computeWaAiTriageProgress({ playbook, facts: base, now: HOJE, timeZone: TZ });
  assert.equal(reaberto.complete, false);
  assert.equal(reaberto.nextField, 'residencia_tipo');
  assert.equal(reaberto.stage, 'residencia');
  // E a pergunta já parte do que o sistema viu, em vez de perguntar do zero.
  const acao = computeWaAiTriageNextAction(playbook, reaberto);
  assert.match(acao.type === 'ask_field' ? acao.question : '', /comprovante está em outro nome/i);

  const rota = (residencia_tipo: string) => computeWaAiTriageProgress({
    playbook, facts: { ...base, residencia_tipo }, now: HOJE, timeZone: TZ,
  });
  assert.equal(rota('aluguel_com_contrato').complete, true);
  assert.deepEqual(rota('pai_ou_mae').missing, ['titular_comprovante']);
  assert.deepEqual(rota('conjuge').missing, ['titular_comprovante']);
  // Companheiro cai na mesma coleta da declaração, sem certidão que o prove.
  assert.deepEqual(rota('companheiro').missing,
    ['declarante_nome', 'endereco_residencia', 'declarante_tem_documento']);
  assert.deepEqual(rota('terceiro_sem_contrato').missing,
    ['declarante_nome', 'endereco_residencia', 'declarante_tem_documento']);
});

test('declarante sem documento corta a triagem em vez de gerar pasta impossível', () => {
  const progress = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: {
      residencia_tipo: 'terceiro_sem_contrato', declarante_nome: 'José',
      endereco_residencia: 'Rua A, 10', declarante_tem_documento: 'não',
    },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(progress.cut?.id, 'declarante_sem_documento');
  assert.deepEqual(progress.pending, []);
});

test('a prova mínima é pedida, não só perguntada', () => {
  // A pessoa que responde "sim" e não manda nada obriga a IA a pedir de novo.
  // Convidar o envio na própria pergunta resolve o caso comum, e a mídia não se
  // perde: a triagem documental segura o arquivo até a solicitação existir.
  const field = WA_AI_PLAYBOOK_CONTA_BLOQUEADA.fields.find(item => item.key === 'tem_print');
  assert.match(String(field?.question), /pode mandar aqui agora/i);
});

test('o KIT não é prometido ao cliente antes de o sistema enviá-lo', () => {
  const text = waAiPlaybookInstructions(WA_AI_PLAYBOOK_CONTA_BLOQUEADA);
  assert.match(text, /Nunca prometa, anuncie ou cite o KIT CONSUMIDOR antes/);
  assert.match(text, /NÃO cite o KIT nem prometa nenhum passo seguinte/);
  // E os documentos saem em lista, não emendados numa frase.
  assert.match(text, /UM POR LINHA/);
});

test('a rota do atendimento é identificada pelo relato, nunca perguntada', () => {
  const playbook = WA_AI_PLAYBOOK_CONTA_BLOQUEADA;
  const campo = playbook.fields.find(item => item.key === 'tipo_atendimento')!;
  // Sem pergunta e sem obrigatoriedade: é o par que impede o motor de colocar
  // isso na fila. A campanha é direcionada — quem chega veio pela conta.
  assert.equal(campo.required, false);
  assert.equal(campo.question, undefined);

  // Conversa nova, nada respondido: a primeira pergunta é o nome e a segunda é
  // o banco. A rota não aparece no meio.
  const primeira = computeWaAiTriageProgress({ playbook, facts: {}, now: HOJE, timeZone: TZ });
  assert.equal(primeira.nextField, 'nome');
  const segunda = computeWaAiTriageProgress({
    playbook, facts: { nome: 'Igor' }, now: HOJE, timeZone: TZ,
  });
  assert.equal(segunda.nextField, 'banco_reu');
  assert.equal(segunda.missing.includes('tipo_atendimento'), false);

  // E o desvio continua funcionando quando o valor é IDENTIFICADO pela
  // extração, sem nunca ter sido perguntado.
  const desviado = computeWaAiTriageProgress({
    playbook, facts: { nome: 'Igor', tipo_atendimento: 'outro_assunto_juridico' },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(desviado.stage, 'outro_assunto_juridico');
  assert.equal(desviado.missing.includes('banco_reu'), false);
});

test('quem trocou de assunto nunca chega à etapa de residência', () => {
  const progress = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_CONTA_BLOQUEADA,
    facts: { nome: 'Igor', tipo_atendimento: 'outro_assunto_juridico' },
    now: HOJE, timeZone: TZ,
  });
  assert.equal(progress.missing.some(key => key.includes('residencia')
    || key.includes('declarante') || key === 'titular_comprovante'), false);
});

// ── Valores ─────────────────────────────────────────────────────────────────

test('cada tipo aceita só o que sabe ler', () => {
  const inicio = waAiPlaybookField(ROTEIRO, 'inicio')!;
  assert.equal(normalizeWaAiPlaybookValue(inicio, '01/2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, '1/2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, 'Janeiro de 2020'), '01/2020');
  assert.equal(normalizeWaAiPlaybookValue(inicio, '05/01/2020'), '01/2020');
  // Ano solto não fecha a pergunta: falta metade da resposta.
  assert.equal(normalizeWaAiPlaybookValue(inicio, '2020'), '');
  assert.equal(normalizeWaAiPlaybookValue(inicio, 'faz uns três anos'), '');

  const ainda = waAiPlaybookField(ROTEIRO, 'ainda_trabalha')!;
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'Sim'), 'sim');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'não'), 'não');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'já saí'), 'não');
  assert.equal(normalizeWaAiPlaybookValue(ainda, 'mais ou menos'), '');

  const tipo = waAiPlaybookField(ROTEIRO, 'tipo_empregador')!;
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'Público'), 'publico');
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'particular'), 'particular');
  assert.equal(normalizeWaAiPlaybookValue(tipo, 'prefeitura'), '');
});

test('valor que não serve ao campo volta a ser pendência, em vez de passar batido', () => {
  // "prefeitura" não é uma das opções: se contasse como preenchido, o corte de
  // órgão público ficaria sem disparar e a triagem seguiria em frente.
  const p = progresso({ nome: 'Ana', empregador: 'Prefeitura', tipo_empregador: 'prefeitura' });
  assert.equal(p.cut, null);
  assert.equal(p.nextField, 'tipo_empregador');
});

// ── Pendências e etapas ─────────────────────────────────────────────────────

test('a conversa começa pela primeira etapa, uma pergunta por vez', () => {
  const p = progresso({});
  assert.equal(p.stage, 'identificacao');
  assert.equal(p.nextField, 'nome');
  assert.equal(p.pending[0], 'o seu nome');
  assert.equal(p.complete, false);
});

test('campo preenchido sai da fila e a etapa anda', () => {
  const p = progresso({ nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular' });
  assert.equal(p.stage, 'periodo');
  assert.equal(p.nextField, 'inicio');
  assert.equal(p.missing.indexOf('nome'), -1);
});

test('a saída só é perguntada de quem já saiu', () => {
  const trabalhando = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim',
  });
  assert.equal(trabalhando.missing.indexOf('saida'), -1);
  assert.equal(trabalhando.stage, 'vinculo');

  const saiu = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'não',
  });
  assert.equal(saiu.nextField, 'saida');
});

test('quais provas só é cobrado de quem disse ter prova', () => {
  const base = {
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim', funcao: 'vendedora', pessoalidade: 'sim',
    recebia_pagamento: 'sim', pagamento: 'Pix, 2000', trabalho_regular: 'regular',
    habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
  };
  const semProva = progresso({ ...base, tem_prova: 'não' });
  assert.equal(semProva.missing.indexOf('provas'), -1);
  assert.equal(semProva.nextField, 'tem_testemunha');

  const comProva = progresso({ ...base, tem_prova: 'sim' });
  assert.equal(comProva.nextField, 'provas');
});

test('roteiro cumprido não deixa pendência nenhuma', () => {
  const p = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2025', ainda_trabalha: 'sim', funcao: 'vendedora', pessoalidade: 'sim',
    recebia_pagamento: 'sim', pagamento: 'Pix, 2000', trabalho_regular: 'regular',
    habitualidade: 'seg a sex, 8h às 17h', subordinacao: 'sim',
    tem_prova: 'sim', provas: 'conversas de WhatsApp', tem_testemunha: 'sim',
    outros_trabalhos: 'não', envio_provas: 'sim', aceita_honorarios: 'sim',
  });
  assert.equal(p.complete, true);
  assert.deepEqual(p.pending, []);
  assert.equal(p.nextField, null);
});

// ── Cortes ──────────────────────────────────────────────────────────────────

test('órgão público encerra como não qualificado, sem transferência', () => {
  const p = progresso({ nome: 'Ana', empregador: 'Prefeitura', tipo_empregador: 'publico' });
  assert.equal(p.cut?.id, 'orgao_publico');
  assert.equal(p.cut?.effect, 'disqualify');
  assert.match(p.cut?.guidance || '', /NÃO QUALIFICADO — ÓRGÃO PÚBLICO/);
  assert.deepEqual(p.pending, []);
  assert.equal(p.nextField, null);
});

test('a janela de dois anos conta o mês inteiro a favor do cliente', () => {
  // Hoje é 12/08/2026; o corte é 12/08/2024.
  const dentro = { ainda_trabalha: 'não', saida: '08/2024', tipo_empregador: 'particular' };
  const fora = { ainda_trabalha: 'não', saida: '07/2024', tipo_empregador: 'particular' };

  assert.equal(evaluateWaAiCuts(ROTEIRO, dentro, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, fora, HOJE, TZ)?.id, 'prazo_2_anos');
});

test('a data que o modelo errava: quem saiu em 2020 não passa', () => {
  const p = progresso({
    nome: 'Neto', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2020', ainda_trabalha: 'não', saida: '08/2020',
  });
  assert.equal(p.cut?.id, 'prazo_2_anos');
  assert.equal(p.cut?.effect, 'disqualify');
});

test('quem ainda trabalha lá nunca é cortado pelo prazo', () => {
  const p = progresso({
    nome: 'Ana', empregador: 'Todimo', tipo_empregador: 'particular',
    inicio: '01/2018', ainda_trabalha: 'sim',
  });
  assert.equal(p.cut, null);
});

test('campo vazio não corta ninguém', () => {
  assert.equal(evaluateWaAiCuts(ROTEIRO, {}, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, { tem_prova: 'não' }, HOJE, TZ), null);
});

test('uma prova OU uma testemunha segura o caso; faltar as duas é que corta', () => {
  const base = { tipo_empregador: 'particular', ainda_trabalha: 'sim' };
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'não', tem_testemunha: 'sim' }, HOJE, TZ), null);
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'sim', tem_testemunha: 'não' }, HOJE, TZ), null);
  assert.equal(
    evaluateWaAiCuts(ROTEIRO, { ...base, tem_prova: 'não', tem_testemunha: 'não' }, HOJE, TZ)?.id,
    'sem_prova_nem_testemunha');
});

test('órgão público vem antes do prazo e mantém o encerramento comercial correto', () => {
  const p = progresso({ tipo_empregador: 'publico', ainda_trabalha: 'não', saida: '01/2019' });
  assert.equal(p.cut?.id, 'orgao_publico');
});

test('os quatro elementos mínimos geram cortes objetivos e independentes do modelo', () => {
  const base = { tipo_empregador: 'particular', ainda_trabalha: 'sim' };
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'não' }, HOJE, TZ)?.id, 'sem_pessoalidade');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'não' }, HOJE, TZ)?.id, 'sem_pagamento');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'sim', trabalho_regular: 'esporadico' }, HOJE, TZ)?.id, 'trabalho_esporadico');
  assert.equal(evaluateWaAiCuts(ROTEIRO, { ...base, pessoalidade: 'sim', recebia_pagamento: 'sim', trabalho_regular: 'regular', subordinacao: 'não' }, HOJE, TZ)?.id, 'sem_subordinacao');
});

// ── Schema ──────────────────────────────────────────────────────────────────

test('o schema fecha a lista de chaves e não deixa inventar campo', () => {
  const schema = buildWaAiTriageSchema(ROTEIRO) as unknown as {
    strict: boolean;
    schema: { properties: Record<string, any>; required: string[]; additionalProperties: boolean };
  };
  assert.equal(schema.strict, true);
  assert.equal(schema.schema.additionalProperties, false);
  assert.deepEqual(schema.schema.required, ['mensagem_cliente', 'campo_alvo', 'atualizacoes']);

  const atualizacoes = schema.schema.properties.atualizacoes;
  assert.equal(atualizacoes.additionalProperties, false);
  // Modo estrito: TODA chave declarada tem de estar em `required`.
  assert.deepEqual(
    atualizacoes.required.slice().sort(),
    Object.keys(atualizacoes.properties).sort());
  assert.deepEqual(atualizacoes.required, waAiPlaybookFieldKeys(ROTEIRO));
  assert.equal(atualizacoes.properties.empresa, undefined);
  assert.equal(atualizacoes.properties.data_inicio, undefined);
});

test('nada no schema é nulo: ausência é string vazia', () => {
  const schema = buildWaAiTriageSchema(ROTEIRO) as unknown as { schema: { properties: Record<string, any> } };
  const props = schema.schema.properties.atualizacoes.properties;
  for (const key of Object.keys(props)) {
    assert.equal(props[key].type, 'string', `${key} deveria ser string`);
    if (props[key].enum) assert.equal(props[key].enum[0], '', `${key} deveria aceitar vazio`);
  }
  assert.deepEqual(props.ainda_trabalha.enum, ['', 'sim', 'não']);
  assert.deepEqual(props.tipo_empregador.enum, ['', 'particular', 'publico']);
  assert.equal(schema.schema.properties.campo_alvo.enum[0], '');
});

// ── Bloco de prompt ─────────────────────────────────────────────────────────

test('o corte chega ao modelo como ordem, não como conta a fazer', () => {
  const p = progresso({ tipo_empregador: 'particular', ainda_trabalha: 'não', saida: '07/2024' });
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, p);
  assert.match(bloco, /JÁ FOI ENCERRADO/);
  assert.match(bloco, /saiu há mais de dois anos/);
  assert.doesNotMatch(bloco, /compare|calcule/i);
});

test('o bloco lista só o que falta, na ordem', () => {
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, progresso({ nome: 'Ana' }));
  assert.match(bloco, /Etapa atual: Quem é e para quem trabalhou/);
  assert.match(bloco, /- para quem você trabalhou/);
  assert.doesNotMatch(bloco, /o seu nome/);
});

// ── O prompt montado a partir do roteiro ────────────────────────────────────

test('a pergunta mora ao lado do campo que ela busca', () => {
  const bloco = waAiPlaybookPromptBlock(ROTEIRO, progresso({ nome: 'Ana' }));
  assert.match(bloco, /Para qual empresa ou pessoa você trabalhou sem registro\?/);
  // Só a da vez: listar as outras aqui seria devolver ao modelo a escolha que
  // o roteiro acabou de fazer por ele.
  assert.doesNotMatch(bloco, /Em que mês e ano você começou/);
});

test('campo sem pergunta escrita não inventa aspas no prompt', () => {
  const semPergunta: WaAiPlaybook = {
    ...ROTEIRO,
    fields: ROTEIRO.fields.map(f => ({ ...f, question: undefined })),
  };
  const p = computeWaAiTriageProgress({ playbook: semPergunta, facts: {}, now: HOJE, timeZone: TZ });
  const bloco = waAiPlaybookPromptBlock(semPergunta, p);
  assert.match(bloco, /o seu nome/);
  assert.doesNotMatch(bloco, /A pergunta desta vez/);
});

test('o "o que fazer" sai do roteiro, com abertura, estilo e fechamento', () => {
  const texto = waAiPlaybookInstructions(ROTEIRO);
  assert.match(texto, /# Como você conversa/);
  assert.match(texto, /- Uma pergunta por vez/);
  assert.match(texto, /# Abertura/);
  assert.match(texto, /Vou fazer algumas perguntas rápidas/);
  assert.match(texto, /# Como perguntar cada coisa/);
  assert.match(texto, /# Quando o roteiro estiver completo/);
  assert.match(texto, /STATUS: LEAD QUALIFICADO/);
});

test('a linha em branco da abertura sobrevive — é ela que vira duas mensagens', () => {
  const lido = normalizeWaAiPlaybook({
    fields: [{ key: 'nome', type: 'texto' }],
    opening: 'Olá! Tudo bem?\n\nQual é o seu nome?',
  }) as WaAiPlaybook;
  assert.equal(lido.opening, 'Olá! Tudo bem?\n\nQual é o seu nome?');
});

test('roteiro sem abertura nem estilo não gera cabeçalho vazio', () => {
  const magro = normalizeWaAiPlaybook({ fields: [{ key: 'nome', type: 'texto', ask: 'o nome' }] }) as WaAiPlaybook;
  assert.equal(waAiPlaybookInstructions(magro), '');
});

// ── Roteiro vindo de fora ───────────────────────────────────────────────────

test('o roteiro em produção sobrevive à própria normalização', () => {
  assert.deepEqual(normalizeWaAiPlaybook(WA_AI_PLAYBOOK_SEM_REGISTRO), WA_AI_PLAYBOOK_SEM_REGISTRO);
});

test('o que não presta sai e o que sobra funciona', () => {
  const lido = normalizeWaAiPlaybook({
    id: 'Meu Roteiro',
    label: 'Teste',
    fields: [
      { key: 'Nome Completo', label: 'Nome', type: 'texto' },
      { key: 'nome_completo', label: 'Repetido', type: 'texto' },
      { key: '', label: 'Sem chave', type: 'texto' },
      { key: 'uf', label: 'UF', type: 'enum', options: [] },
    ],
    stages: [{ id: 'e1', label: 'Etapa', fields: ['nome_completo', 'campo_que_nao_existe'] }],
    cuts: [
      { id: 'c1', rule: { kind: 'older_than', field: 'campo_que_nao_existe', years: 2 }, reason: 'x' },
      { id: 'c2', rule: { kind: 'sei_la' }, reason: 'y' },
    ],
  }) as WaAiPlaybook;

  assert.equal(lido.id, 'meu_roteiro');
  assert.deepEqual(lido.fields.map(f => f.key), ['nome_completo']);
  assert.deepEqual(lido.stages, [{ id: 'e1', label: 'Etapa', fields: ['nome_completo'] }]);
  assert.deepEqual(lido.cuts, []);
});

test('roteiro sem campo nenhum não vira roteiro', () => {
  assert.equal(normalizeWaAiPlaybook(null), null);
  assert.equal(normalizeWaAiPlaybook({ fields: [] }), null);
  assert.equal(normalizeWaAiPlaybook({ fields: [{ label: 'sem chave' }] }), null);
});

test('roteiro sem etapa ganha uma, na ordem em que os campos foram escritos', () => {
  const lido = normalizeWaAiPlaybook({
    fields: [{ key: 'a', type: 'texto' }, { key: 'b', type: 'texto' }],
  }) as WaAiPlaybook;
  assert.deepEqual(lido.stages, [{ id: 'triagem', label: 'Triagem', fields: ['a', 'b'] }]);
});

test('contexto estruturado sozinho reconhece a campanha e herda os campos declarativos', () => {
  const raw = {
    agent_context: {
      schema_version: '1.0',
      campaign: { id: 'trabalhou_sem_registro', name: 'Trabalhou sem registro na carteira' },
    },
    authority: { playbook: { role: 'fonte_de_verdade_do_fluxo' } },
    information_registration: { updates: { field_name: 'atualizacoes' } },
  };
  const lido = normalizeWaAiPlaybook(raw) as WaAiPlaybook;
  assert.ok(lido.fields.some(f => f.key === 'nome'));
  assert.ok(lido.fields.some(f => f.key === 'inicio'));
  assert.deepEqual(lido.context, raw);
  assert.match(waAiPlaybookInstructions(lido), /fonte_de_verdade_do_fluxo/);
});

test('contexto oficial da campanha já nasce ligado aos campos automáticos', () => {
  const lido = normalizeWaAiPlaybook(WA_AI_CONTEXT_SEM_REGISTRO) as WaAiPlaybook;
  assert.equal(lido.id, 'sem_registro_carteira');
  assert.deepEqual(lido.context, WA_AI_CONTEXT_SEM_REGISTRO);
  assert.equal(lido.fields.length, 19);
  assert.equal(lido.stages.length, 7);
  assert.equal(lido.cuts.length, 8);
});

test('roteiro materializado antigo recebe os novos campos e cortes ao ser lido', () => {
  const antigo = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)) as WaAiPlaybook;
  antigo.fields = antigo.fields.filter(field =>
    !['funcao', 'recebia_pagamento', 'trabalho_regular', 'envio_provas', 'aceita_honorarios']
      .includes(field.key));
  antigo.cuts = antigo.cuts.filter(cut =>
    !['sem_pessoalidade', 'sem_pagamento', 'trabalho_esporadico', 'sem_subordinacao',
      'honorarios_nao_aceitos'].includes(cut.id));
  const lido = normalizeWaAiPlaybook(antigo) as WaAiPlaybook;
  assert.ok(lido.fields.some(field => field.key === 'funcao'));
  assert.ok(lido.fields.some(field => field.key === 'recebia_pagamento'));
  assert.ok(lido.fields.some(field => field.key === 'trabalho_regular'));
  assert.ok(lido.fields.some(field => field.key === 'envio_provas'));
  assert.ok(lido.fields.some(field => field.key === 'aceita_honorarios'));
  assert.ok(lido.cuts.some(cut => cut.id === 'sem_subordinacao'));
  assert.ok(lido.cuts.some(cut => cut.id === 'honorarios_nao_aceitos'));
});

test('agente antigo da campanha herda contexto sem migração de banco', () => {
  const { context: _oldContext, ...oldStoredPlaybook } = WA_AI_PLAYBOOK_SEM_REGISTRO;
  const lido = normalizeWaAiPlaybook(oldStoredPlaybook) as WaAiPlaybook;
  assert.deepEqual(lido.context, WA_AI_CONTEXT_SEM_REGISTRO);
});

test('agente da conta sem etapa de residência é atualizado sem perder os destinos', () => {
  // A geração que ficou salva quando o fechamento era transferência direta:
  // tem os campos novos da conta, mas nenhum de residência. Salvar a tela não
  // corrigiria sozinho — quem corrige é a leitura.
  const antigo = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_CONTA_BLOQUEADA)) as WaAiPlaybook;
  antigo.fields = antigo.fields.filter(field => field.key !== 'residencia_tipo'
    && field.key !== 'titular_comprovante' && field.key !== 'declarante_nome'
    && field.key !== 'endereco_residencia' && field.key !== 'declarante_tem_documento');
  antigo.stages = antigo.stages.filter(stage => stage.id !== 'residencia');
  antigo.cuts = antigo.cuts.filter(cut => cut.id !== 'declarante_sem_documento');
  antigo.closing = 'Transfira imediatamente para atendimento humano.';
  // O escritório já tinha escolhido o KIT nesta instalação.
  antigo.bindings = [{
    key: 'modelo_kit_consumidor', label: 'KIT CONSUMIDOR', action: 'enviar_documento',
    required: true, targetId: 'tpl-1', targetType: 'document_template',
    targetLabel: 'KIT CONSUMIDOR — escolhido pelo escritório',
  }];

  const lido = normalizeWaAiPlaybook(antigo) as WaAiPlaybook;
  assert.ok(lido.fields.some(field => field.key === 'residencia_tipo'));
  assert.ok(lido.fields.some(field => field.key === 'declarante_tem_documento'));
  assert.ok(lido.stages.some(stage => stage.id === 'residencia'));
  assert.ok(lido.cuts.some(cut => cut.id === 'declarante_sem_documento'));
  assert.match(lido.closing || '', /ação=enviar_documento\(\{\{modelo_kit_consumidor\}\}\)/);
  // O destino escolhido continua de pé: a migração troca o roteiro, não a
  // configuração da tela. Os dois vínculos que faltavam nascem sozinhos, do
  // `{{...}}` que o novo fechamento trouxe — sem alvo, à espera da escolha.
  const kit = lido.bindings?.find(item => item.key === 'modelo_kit_consumidor');
  assert.equal(kit?.targetId, 'tpl-1');
  assert.equal(kit?.targetLabel, 'KIT CONSUMIDOR — escolhido pelo escritório');
  assert.deepEqual(lido.bindings?.map(item => item.key),
    ['modelo_kit_consumidor', 'destino_declaracao_residencia', 'destino_pos_assinatura']);
});

test('agente já na versão atual da conta não é reescrito pela migração', () => {
  const atual = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_CONTA_BLOQUEADA)) as WaAiPlaybook;
  atual.closing = 'Fechamento ajustado à mão pelo escritório.';
  const lido = normalizeWaAiPlaybook(atual) as WaAiPlaybook;
  assert.equal(lido.closing, 'Fechamento ajustado à mão pelo escritório.');
});

test('nomes operacionais ficam nos vínculos, não no JSON visível', () => {
  const contextText = JSON.stringify(WA_AI_CONTEXT_SEM_REGISTRO);
  assert.doesNotMatch(contextText, /Pedro Rodrigues Montalvao Neto/);
  assert.match(contextText, /\{\{destino_revisao_prazo\}\}/);
  assert.equal(
    resolveWaAiPlaybookBindings(ROTEIRO, 'ação=transferir({{destino_revisao_prazo}})'),
    'ação=transferir(Pedro Rodrigues Montalvao Neto)',
  );
});

test('JSON antigo com pessoa fixa é elevado automaticamente para configuração da tela', () => {
  const oldContext = JSON.parse(JSON.stringify(WA_AI_CONTEXT_SEM_REGISTRO)) as any;
  oldContext.triage_closure.post_closure_insistence.required_action = {
    type: 'transferir', target: 'Pedro Rodrigues Montalvao Neto',
    exact_action: 'ação=transferir(Pedro Rodrigues Montalvao Neto)',
  };
  oldContext.action_catalog.transferir_especifico = {
    syntax: 'ação=transferir(Pedro Rodrigues Montalvao Neto)',
    target: 'Pedro Rodrigues Montalvao Neto',
  };
  const lido = normalizeWaAiPlaybook(oldContext) as WaAiPlaybook;
  const text = JSON.stringify(lido.context);
  assert.doesNotMatch(text, /Pedro Rodrigues Montalvao Neto/);
  assert.match(text, /destino_revisao_prazo/);
  assert.equal(lido.bindings?.length, 2);
});

test('agente antigo não mantém transferência configurável para órgão público', () => {
  const old = JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)) as any;
  old.bindings.unshift({
    key: 'destino_orgao_publico', label: 'Órgão público',
    action: 'transferir_atendimento', required: true,
  });
  const cut = old.cuts.find((item: any) => item.id === 'orgao_publico');
  cut.effect = 'handoff';
  cut.guidance = 'Transfira para alguém.';
  const lido = normalizeWaAiPlaybook(old) as WaAiPlaybook;
  assert.equal(lido.bindings?.some(binding => binding.key === 'destino_orgao_publico'), false);
  assert.equal(lido.cuts.find(item => item.id === 'orgao_publico')?.effect, 'disqualify');
});

test('fechamento antigo também passa a usar a escolha configurável', () => {
  const lido = normalizeWaAiPlaybook({
    ...WA_AI_PLAYBOOK_SEM_REGISTRO,
    closing: 'Ao terminar faça ação=transferir(Atendimento).',
  }) as WaAiPlaybook;
  assert.equal(lido.closing, 'Ao terminar faça ação=transferir({{destino_triagem_concluida}}).');
  assert.match(waAiPlaybookInstructions(lido), /ação=transferir\(Atendimento\)/);
});

test('placeholder de template cria seletor sem precisar alterar a tela', () => {
  const lido = normalizeWaAiPlaybook({
    id: 'contrato',
    fields: [{ key: 'nome', type: 'texto' }],
    closing: 'Envie ação=enviar_documento({{modelo_contrato}}).',
  }) as WaAiPlaybook;
  assert.deepEqual(lido.bindings, [{
    key: 'modelo_contrato',
    label: 'Modelo contrato',
    description: 'Escolha usada quando o roteiro executar ação=enviar_documento.',
    action: 'enviar_documento',
    required: true,
  }]);
});

test('schema de extração nasce dos campos e diferencia false de null', () => {
  const schema = buildWaAiTriageExtractionSchema(ROTEIRO).schema as any;
  const updates = schema.properties.atualizacoes;
  assert.deepEqual(updates.properties.ainda_trabalha.type, ['boolean', 'null']);
  assert.ok(updates.required.includes('nome'));
  assert.equal(updates.additionalProperties, false);

  const conversation = buildWaAiTriageConversationSchema(ROTEIRO).schema as any;
  assert.deepEqual(conversation.required, ['mensagem_cliente', 'campo_alvo']);
  assert.equal('atualizacoes' in conversation.properties, false);
});

test('ação seguinte é derivada do primeiro campo pendente', () => {
  const p = progresso({ nome: 'Ana' });
  const action = computeWaAiTriageNextAction(ROTEIRO, p);
  assert.equal(action.type, 'ask_field');
  if (action.type === 'ask_field') assert.equal(action.field, 'empregador');
});

test('fato condicional antigo não dispara corte quando deixou de se aplicar', () => {
  const cut = evaluateWaAiCuts(
    ROTEIRO,
    { ainda_trabalha: true, saida: '01/2020' },
    HOJE,
    TZ,
  );
  assert.equal(cut, null);
});

// ── onlyWhen com LISTA de valores ───────────────────────────────────────────
//
// 14/08/2026, conversa 358ea6b3, 23:17. A triagem documental leu o comprovante,
// viu que o titular era o pai do cliente e resolveu a rota sozinha, gravando
// `residencia_tipo = 'pai_ou_mae'` e `titular_comprovante = 'Jose Alvino...'`.
// Um turno depois o `titular_comprovante` tinha sumido dos fatos e a IA
// perguntou "qual é o nome completo da pessoa que aparece no comprovante?" —
// depois de já ter mandado o KIT.
//
// A causa era uma segunda leitura do mesmo `onlyWhen`, escrita à mão no agente,
// que comparava com `String(value)`: para `['pai_ou_mae','conjuge']` isso é
// "pai_ou_mae,conjuge" e nunca bate. O campo era apagado a cada turno e o motor
// de etapas, que lê certo, tornava a perguntar. Laço infinito.

test('onlyWhen aceita lista de valores, e qualquer um deles satisfaz', () => {
  const playbook = normalizeWaAiPlaybook({ id: 'bloqueio_encerramento_conta' });
  assert.ok(playbook, 'roteiro nativo não carregou');
  const campo = waAiPlaybookField(playbook!, 'titular_comprovante');
  assert.ok(campo, 'titular_comprovante saiu do roteiro nativo');
  assert.deepEqual(campo!.onlyWhen?.value, ['pai_ou_mae', 'conjuge']);

  for (const rota of ['pai_ou_mae', 'conjuge']) {
    assert.equal(
      waAiPlaybookOnlyWhenSatisfied(playbook!, campo!, { residencia_tipo: rota }),
      true,
      `a rota ${rota} deveria manter o titular do comprovante aplicável`,
    );
  }
});

test('onlyWhen com lista rejeita valor de fora, e sem o dono não se aplica', () => {
  const playbook = normalizeWaAiPlaybook({ id: 'bloqueio_encerramento_conta' })!;
  const campo = waAiPlaybookField(playbook, 'titular_comprovante')!;
  assert.equal(
    waAiPlaybookOnlyWhenSatisfied(playbook, campo, { residencia_tipo: 'aluguel_com_contrato' }),
    false,
  );
  // Sem a rota decidida, o campo ainda não vale — não é para perguntar.
  assert.equal(waAiPlaybookOnlyWhenSatisfied(playbook, campo, {}), false);
});

// ── Sem fala, sem veredito ──────────────────────────────────────────────────

test('corte não dispara quando o cliente não disse nada (a triagem da foto)', () => {
  // Os fatos que o modelo inventou a partir de um único "[imagem]".
  const inventados = { inicio: '01/2020', saida: '12/2022', ainda_trabalha: false };
  const comFala = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_SEM_REGISTRO, facts: inventados,
    now: new Date('2026-08-24T12:10:00Z'),
  });
  assert.equal(comFala.cut?.id, 'prazo_2_anos');

  const semFala = computeWaAiTriageProgress({
    playbook: WA_AI_PLAYBOOK_SEM_REGISTRO, facts: inventados,
    now: new Date('2026-08-24T12:10:00Z'), customerSpoke: false,
  });
  assert.equal(semFala.cut, null);
  // E a conversa continua: há pendência para perguntar, não um fim.
  assert.ok(semFala.missing.length > 0);
});

test('customerSpoke omitido não muda nada do que já valia', () => {
  const facts = { inicio: '01/2020', saida: '12/2022', ainda_trabalha: false };
  const agora = new Date('2026-08-24T12:10:00Z');
  assert.equal(
    computeWaAiTriageProgress({ playbook: WA_AI_PLAYBOOK_SEM_REGISTRO, facts, now: agora }).cut?.id,
    computeWaAiTriageProgress({
      playbook: WA_AI_PLAYBOOK_SEM_REGISTRO, facts, now: agora, customerSpoke: true,
    }).cut?.id,
  );
});

// ── Ano dito, não chutado ───────────────────────────────────────────────────

test('"Dia 1 setembro" não sustenta 09/2023 — o ano foi inventado', () => {
  assert.equal(waAiDateSaidByCustomer('09/2023', 'Dia 1 setembro'), false);
});

test('ano escrito por extenso sustenta a data', () => {
  assert.equal(waAiDateSaidByCustomer('09/2023', 'comecei em setembro de 2023'), true);
});

test('duração dita pelo cliente sustenta a conta do ano', () => {
  assert.equal(waAiDateSaidByCustomer('02/2025', 'Tenho 1ano e 6 meses'), true);
  assert.equal(waAiDateSaidByCustomer('08/2023', 'faz 3 anos que trabalho lá'), true);
  assert.equal(waAiDateSaidByCustomer('12/2025', 'sai ano passado'), true);
});

test('data escrita com ano curto sustenta', () => {
  assert.equal(waAiDateSaidByCustomer('09/2024', 'foi 01/09/24'), true);
  assert.equal(waAiDateSaidByCustomer('09/2024', 'foi 09/24'), true);
});

test('valor sem ano não é conferido, e fala vazia nunca sustenta', () => {
  assert.equal(waAiDateSaidByCustomer('', 'qualquer coisa'), true);
  assert.equal(waAiDateSaidByCustomer('setembro', 'qualquer coisa'), true);
  assert.equal(waAiDateSaidByCustomer('09/2023', ''), false);
  assert.equal(waAiDateSaidByCustomer('09/2023', '[imagem]'), false);
});

test('valor em reais não vira prova de tempo', () => {
  assert.equal(waAiDateSaidByCustomer('09/2023', 'recebia 1200 por mês'), false);
});
