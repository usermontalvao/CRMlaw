import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WA_AI_DOC_INTAKE_MAX_ATTEMPTS,
  WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE,
  WA_AI_REQUEST_DESCRIPTION_PREFIX,
  isWaAiCreatedDocumentRequest,
  shouldReadWaAiDocIntakeAgain,
  waAiDocIntakeMarkForNoMatch,
} from './waAiDocIntake.ts';
import { waAiAccountRouteDocument } from './waAiCompletion.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiDocIntake.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-doc-intake.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-doc-intake.ts divergiu — copie o arquivo inteiro');
});

// ── A fila do cron ──────────────────────────────────────────────────────────
//
// O caso real: conversa 358ea6b3, 14/08/2026. O cliente mandou três arquivos
// às 21:30 enquanto o único pedido aberto era resíduo da rodada anterior, sem
// item pendente nenhum. O pedido CERTO só nasceu às 21:42:12. Um `no_match`
// escrito às 21:33 tem de voltar à fila quando esse pedido aparece.

const JULGADO = '2026-08-14T21:33:00.000Z';
const PEDIDO_NOVO = '2026-08-14T21:42:12.258Z';
const PEDIDO_VELHO = '2026-08-14T20:01:50.196Z';

test('arquivo nunca lido sempre entra na fila', () => {
  assert.equal(shouldReadWaAiDocIntakeAgain({ status: null }, []), true);
  assert.equal(shouldReadWaAiDocIntakeAgain({ status: '' }, []), true);
});

test('no_match volta à fila quando nasceu um pedido depois do veredito', () => {
  assert.equal(
    shouldReadWaAiDocIntakeAgain(
      { status: 'no_match', attempts: 1, intakeAt: JULGADO },
      [PEDIDO_VELHO, PEDIDO_NOVO],
    ),
    true,
  );
});

test('no_match NÃO volta quando a lista de pedidos é a mesma de antes', () => {
  assert.equal(
    shouldReadWaAiDocIntakeAgain(
      { status: 'no_match', attempts: 1, intakeAt: JULGADO },
      [PEDIDO_VELHO],
    ),
    false,
  );
  // Sem pedido aberto nenhum também não há lista nova para comparar.
  assert.equal(
    shouldReadWaAiDocIntakeAgain({ status: 'no_match', attempts: 1, intakeAt: JULGADO }, []),
    false,
  );
});

test('a releitura tem freio: três tentativas e o arquivo sai da fila', () => {
  const candidato = {
    status: 'no_match',
    attempts: WA_AI_DOC_INTAKE_MAX_ATTEMPTS,
    intakeAt: JULGADO,
  };
  assert.equal(shouldReadWaAiDocIntakeAgain(candidato, [PEDIDO_NOVO]), false);
  assert.equal(
    shouldReadWaAiDocIntakeAgain({ ...candidato, attempts: WA_AI_DOC_INTAKE_MAX_ATTEMPTS - 1 }, [PEDIDO_NOVO]),
    true,
  );
});

test('veredito antigo, sem data gravada, ganha uma chance', () => {
  assert.equal(
    shouldReadWaAiDocIntakeAgain({ status: 'no_match', attempts: 0, intakeAt: null }, []),
    true,
  );
});

test('matched, skipped, error e ai_unavailable não voltam à fila', () => {
  for (const status of ['matched', 'skipped', 'error', 'ai_unavailable']) {
    assert.equal(
      shouldReadWaAiDocIntakeAgain({ status, attempts: 0, intakeAt: JULGADO }, [PEDIDO_NOVO]),
      false,
      `${status} não pode voltar à fila`,
    );
  }
});

// ── O redisparo por message_ids não pode desfazer o que já deu certo ────────
//
// Em 14/08/2026 as mensagens 9ffa4f6e e e8afca60 tinham upload aprovado no
// pedido f3c4f11a e, ainda assim, terminaram o dia marcadas `no_match`: o
// redisparo das 21:43:41 releu as duas contra a lista que elas mesmas tinham
// acabado de esvaziar.

test('no_match não rebaixa uma mensagem que já estava casada', () => {
  assert.equal(waAiDocIntakeMarkForNoMatch('matched'), null);
});

test('no_match é gravado normalmente nos demais estados', () => {
  assert.equal(waAiDocIntakeMarkForNoMatch(null), 'no_match');
  assert.equal(waAiDocIntakeMarkForNoMatch(''), 'no_match');
  assert.equal(waAiDocIntakeMarkForNoMatch('no_match'), 'no_match');
  assert.equal(waAiDocIntakeMarkForNoMatch('error'), 'no_match');
});

// ── O que o "/clear" pode cancelar ──────────────────────────────────────────
//
// As linhas abaixo são as de produção, com id e tudo, porque a regra errada
// tem dois modos de falhar e os dois estão representados aqui: deixar de
// cancelar um pedido da IA com título livre, e cancelar o checklist de um
// advogado que ficou sem autor gravado.

const IA_TITULO_CANONICO = {
  id: '0edfd18b-ae23-467c-831f-70e070a658c5',
  created_by: null,
  description: 'Solicitado pelo assistente de IA (Campanha — Conta bloqueada ou encerrada sem aviso) no WhatsApp.',
};
const IA_TITULO_LIVRE = {
  id: '5a872d66-1137-4e34-b226-b0c6d724c024',
  created_by: null,
  description: 'Solicitado pelo assistente de IA (Campanha — Conta bloqueada ou encerrada sem aviso) no WhatsApp.',
};
const MANUAL_COM_AUTOR = {
  id: '71e457f3-b6f9-4354-9e54-f1c1848040d0',
  created_by: 'f6b77979-d683-4afa-b9a4-482ddae74534',
  description: null,
};
const MANUAL_SEM_AUTOR_ANTIGO = {
  id: '768a42da-54c9-47e9-aecb-4bf355d1e61d',
  created_by: null,
  description: 'Documentos necessarios',
};

test('o reinício cancela o pedido da IA, inclusive o de título livre', () => {
  assert.equal(isWaAiCreatedDocumentRequest(IA_TITULO_CANONICO), true);
  assert.equal(isWaAiCreatedDocumentRequest(IA_TITULO_LIVRE), true);
});

test('o reinício não encosta em solicitação feita à mão pelo advogado', () => {
  assert.equal(isWaAiCreatedDocumentRequest(MANUAL_COM_AUTOR), false);
  // Sem autor gravado, mas sem o carimbo: é manual antiga e continua de pé.
  assert.equal(isWaAiCreatedDocumentRequest(MANUAL_SEM_AUTOR_ANTIGO), false);
  assert.equal(isWaAiCreatedDocumentRequest({ created_by: null, description: null }), false);
  assert.equal(isWaAiCreatedDocumentRequest(null), false);
});

test('o carimbo é o mesmo que a ação escreve', () => {
  const escrito = `${WA_AI_REQUEST_DESCRIPTION_PREFIX} (Campanha — Sem registro na carteira) no WhatsApp.`;
  assert.equal(isWaAiCreatedDocumentRequest({ created_by: null, description: escrito }), true);
});

// ── Os dois juízes têm de saber a mesma coisa ───────────────────────────────
//
// O arquivo passa por DUAS análises de visão. Em 14/08/2026 só a primeira tinha
// o conhecimento de domínio, e o resultado foi a etapa 1 casar a CNH com
// "Documento de identificação com foto do cliente" (90%) e a etapa 2 recusar a
// MESMA CNH por "não identifica explicitamente como RG". Item parado em
// `uploaded`, pedido eterno em `partial`, escada inalcançável.
//
// Este teste não confere texto de prompt: confere que os dois prompts são
// alimentados pela MESMA constante. Copiar o texto para um deles faria o outro
// envelhecer em silêncio, que é exatamente como o defeito nasceu.

const PROMPTS_QUE_JULGAM_DOCUMENTO = [
  '../../supabase/functions/whatsapp-doc-intake/index.ts',
  '../../supabase/functions/process-document-upload/index.ts',
];

test('as duas análises de visão leem a mesma constante de domínio', () => {
  for (const caminho of PROMPTS_QUE_JULGAM_DOCUMENTO) {
    const fonte = readFileSync(new URL(caminho, import.meta.url), 'utf8');
    assert.ok(
      fonte.includes('WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE'),
      `${caminho} julga documento sem a constante de domínio — os dois juízes vão divergir de novo`,
    );
    assert.ok(
      /from '\.\.\/_shared\/wa-ai-doc-intake\.ts'/.test(fonte),
      `${caminho} não importa de _shared/wa-ai-doc-intake.ts`,
    );
  }
});

test('o domínio diz o que precisa dizer, nas duas direções', () => {
  const texto = WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE.toLowerCase();
  // A CNH recusada por não ser RG é o caso que motivou tudo.
  assert.ok(texto.includes('cnh'));
  assert.ok(texto.includes('foto'));
  // A conta de água recusada por não trazer o nome do cliente é o outro.
  assert.ok(texto.includes('água') || texto.includes('agua'));
  assert.ok(texto.includes('titularidade'));
});

// ── A rota pai_ou_mae não pede documento nenhum ─────────────────────────────
//
// 14/08/2026, 23:27. O comprovante estava no nome do pai, a filiação do RG
// confirmou, a rota virou `pai_ou_mae` — e mesmo assim o cliente leu "envie uma
// foto do documento de identificação dessa pessoa que mora com você", logo
// antes de a IA se desligar. O backend não tinha pedido nada: `requested_actions`
// da execução traz só `transferir_para_humano`. O pedido foi prosa do modelo.
//
// Este teste fixa a regra de negócio: com pai ou mãe, o RG do próprio cliente
// já traz a filiação, então não há o que pedir. Documento de terceiro só entra
// quando o endereço vai se sustentar numa declaração de residência.

test('só as rotas sem prova documental própria pedem documento extra', () => {
  assert.equal(waAiAccountRouteDocument('pai_ou_mae'), null);
  assert.equal(waAiAccountRouteDocument('conjuge'), 'Certidão de casamento');
  assert.equal(waAiAccountRouteDocument('aluguel_com_contrato'), 'Contrato de aluguel');
  for (const rota of ['companheiro', 'terceiro_sem_contrato']) {
    assert.equal(waAiAccountRouteDocument(rota), 'Documento de identificação com foto do declarante');
  }
  assert.equal(waAiAccountRouteDocument(''), null);
});
