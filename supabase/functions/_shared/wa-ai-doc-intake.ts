/**
 * A fila da triagem documental do WhatsApp — REGRAS PURAS.
 *
 * ATENÇÃO — ESTE ARQUIVO EXISTE EM DUAS CÓPIAS BYTE A BYTE:
 *   src/utils/waAiDocIntake.ts
 *   supabase/functions/_shared/wa-ai-doc-intake.ts
 * (o `rootDir` do tsconfig é `src/`, então front e Edge Function não conseguem
 * importar um do outro). Ao mexer em um, COPIE O ARQUIVO INTEIRO para o outro:
 * `waAiDocIntake.test.ts` compara os dois byte a byte.
 *
 * SEM IMPORTS de propósito — ver memória testes-ts-node-imports.
 *
 * POR QUE ISTO EXISTE
 * O cron lia só `doc_intake_status IS NULL`. Um veredito `no_match` era,
 * portanto, DEFINITIVO — e o veredito depende de uma coisa que muda debaixo
 * dele: a lista de itens pendentes no instante da leitura. Em 14/08/2026, na
 * conversa 358ea6b3, os arquivos 9ffa4f6e e e8afca60 (o print do bloqueio e a
 * CNH) foram julgados contra uma lista que já não tinha esses dois itens e
 * viraram `no_match`. O conteúdo estava certo; a lista é que estava errada.
 * Naquele dia eles só foram salvos porque alguém redisparou a triagem à mão.
 *
 * A regra abaixo devolve a segunda chance SEM transformar o cron em moinho:
 * um `no_match` só volta à fila quando a lista de pedidos MUDOU depois do
 * veredito, e no máximo três vezes. Uma selfie que não é documento nenhum
 * continua saindo da fila; um documento legítimo julgado contra a lista errada
 * volta assim que a lista certa existir.
 */

/** Quantas leituras um mesmo arquivo pode consumir antes de sair da fila. */
export const WA_AI_DOC_INTAKE_MAX_ATTEMPTS = 3;

/**
 * A marca que o próprio assistente escreve em `document_requests.description`.
 *
 * É por ela que o `/clear` separa o resíduo de conversa (que ele cancela) do
 * pedido que um advogado montou à mão (que ele não pode tocar). O TÍTULO não
 * serve para isso: o modelo pode salvar um pedido com título livre, e foi o
 * que aconteceu em 14/08/2026 — dois pedidos "Solicitação de documentos"
 * criados pela IA sobreviveriam a um reinício que os deveria ter fechado.
 */
export const WA_AI_REQUEST_DESCRIPTION_PREFIX = 'Solicitado pelo assistente de IA';

/**
 * Esta solicitação de documentos foi criada pela IA nesta plataforma?
 *
 * Duas condições, e as duas são necessárias:
 *   - `created_by` vazio, porque toda ação da IA grava autor nulo;
 *   - a descrição carimbada, porque `created_by` nulo também acontece em
 *     solicitação MANUAL antiga, feita antes de a coluna passar a ser
 *     preenchida (há três dessas em produção, de maio e junho de 2026).
 *
 * O viés é deliberado: na dúvida, NÃO é da IA. Cancelar por engano o checklist
 * que um advogado montou apaga trabalho de gente; deixar um resíduo de conversa
 * aberto custa, no pior caso, um cancelamento manual.
 */
export function isWaAiCreatedDocumentRequest(
  request: { created_by?: unknown; description?: unknown } | null | undefined,
): boolean {
  if (!request) return false;
  if (request.created_by !== null && request.created_by !== undefined) return false;
  return String(request.description || '').trimStart().indexOf(WA_AI_REQUEST_DESCRIPTION_PREFIX) === 0;
}

/**
 * O que este escritório considera que cada documento É — TEXTO ÚNICO.
 *
 * O arquivo enviado pelo cliente passa por DUAS análises de visão, e até
 * 14/08/2026 só a primeira sabia disto:
 *
 *   1. `whatsapp-doc-intake` decide a QUAL item pedido o arquivo corresponde;
 *   2. `process-document-upload` reconfere e decide se dá baixa automática.
 *
 * A segunda era um prompt genérico. Resultado, na conversa 358ea6b3 às 23:01:
 * a etapa 1 casou a CNH com "Documento de identificação com foto do cliente"
 * (90%) e a etapa 2 respondeu *"é uma carteira de habilitação e não identifica
 * explicitamente como RG"* — `ai_matches = false`, item parado em `uploaded`,
 * pedido eternamente `partial`. Como `documents_completed` só dispara com o
 * pedido `complete`, a escada inteira (KIT, assinatura, transferência) ficava
 * inalcançável, e do lado do cliente a conversa simplesmente parava.
 *
 * Por isso o texto mora AQUI e é injetado nos dois prompts: dois juízes com
 * conhecimento diferente não é redundância, é contradição.
 */
export const WA_AI_DOCUMENT_DOMAIN_KNOWLEDGE = [
  'Conhecimento de domínio deste escritório, que vale acima da sua intuição:',
  '- Conta ou fatura de água, luz, energia, gás, telefone, internet ou TV, e extrato bancário que mostre nome e endereço, SERVEM como "comprovante de residência".',
  '- RG, CNH, CPF, CTPS e passaporte SERVEM como "documento de identificação". A CNH é documento de identificação COM FOTO — recusá-la por não ser um RG é erro.',
  '- DE QUEM é o documento não é critério seu: a titularidade tem conferência própria, em outra etapa. Julgue apenas se o TIPO do arquivo corresponde ao TIPO pedido, e se está legível.',
].join('\n');

function instante(value: string | null | undefined): number | null {
  const parsed = Date.parse(String(value || ''));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Quanto tempo de silêncio do cliente antes de falar dos documentos.
 *
 * Quem manda três fotos manda em rajada, e cada arquivo era um turno: em
 * 14/08/2026 o cliente recebeu "Recebi seus arquivos e já estou conferindo"
 * TRÊS vezes em 22 segundos (23:01:12, 23:01:24, 23:01:34) — e nenhuma das três
 * podia dizer nada de útil, porque a triagem ainda não tinha lido arquivo
 * nenhum. Agora a chegada é MUDA e quem fala é o backend, uma vez só, quando
 * tem o que dizer.
 */
export const WA_AI_DOC_STATUS_QUIET_MS = 5 * 60 * 1000;

export interface WaAiDocStatusMoment {
  /** Instante do arquivo mais recente que o cliente mandou. */
  lastMediaAt?: string | null;
  /** Ainda há arquivo sem veredito da triagem? */
  hasUntriaged?: boolean;
  /** Quando o backend já falou dos documentos desta rodada. */
  lastSentAt?: string | null;
}

/**
 * É hora de dizer ao cliente o que chegou e o que falta?
 *
 * TRÊS condições, e a ordem delas é o desenho:
 *   1. o cliente parou de mandar (silêncio de `WA_AI_DOC_STATUS_QUIET_MS`) —
 *      falar no meio da rajada cobra um documento que está chegando;
 *   2. a triagem leu TUDO — sem isso a lista de faltantes é a de antes dos
 *      arquivos, que foi exatamente o erro de 13/08 e 14/08;
 *   3. ainda não foi dito desde o último arquivo — se já falamos e nada novo
 *      chegou, repetir é a mesma cobrança duas vezes.
 */
export function shouldSendWaAiDocStatus(
  moment: WaAiDocStatusMoment,
  nowMs = Date.now(),
  quietMs = WA_AI_DOC_STATUS_QUIET_MS,
): boolean {
  const ultimoArquivo = instante(moment?.lastMediaAt);
  if (ultimoArquivo === null) return false;
  if (moment?.hasUntriaged) return false;
  if (nowMs - ultimoArquivo < quietMs) return false;

  const jaDito = instante(moment?.lastSentAt);
  return jaDito === null || jaDito < ultimoArquivo;
}

export interface WaAiDocIntakeCandidate {
  /** `doc_intake_status` como está hoje no banco. */
  status?: string | null;
  /** Quantas leituras este arquivo já consumiu. */
  attempts?: number | null;
  /** Quando o veredito atual foi escrito. */
  intakeAt?: string | null;
}

/**
 * Este arquivo entra (ou volta a entrar) na fila de leitura?
 *
 * `openRequestsCreatedAt` são as datas de criação das solicitações ABERTAS do
 * cliente agora. Se nenhuma delas é mais nova que o veredito, a lista é a mesma
 * de antes e reler só gastaria token de visão para chegar ao mesmo `no_match`.
 */
export function shouldReadWaAiDocIntakeAgain(
  candidate: WaAiDocIntakeCandidate,
  openRequestsCreatedAt: (string | null | undefined)[] = [],
): boolean {
  const status = String(candidate?.status || '').trim();
  // Nunca lido: é o caso comum, e o cron sempre o pega.
  if (!status) return true;
  // `matched`, `skipped`, `error` e `ai_unavailable` são decisões que a lista
  // de pendentes não desfaz. Só o `no_match` depende dela.
  if (status !== 'no_match') return false;

  const attempts = Number(candidate?.attempts || 0);
  if (attempts >= WA_AI_DOC_INTAKE_MAX_ATTEMPTS) return false;

  const julgadoEm = instante(candidate?.intakeAt);
  // Veredito sem data é registro anterior a esta regra: vale uma chance, e o
  // limite de tentativas continua sendo o freio.
  if (julgadoEm === null) return true;

  return (openRequestsCreatedAt || []).some(item => {
    const criadoEm = instante(item);
    return criadoEm !== null && criadoEm > julgadoEm;
  });
}

/**
 * O que gravar quando a leitura desta vez não casou com item nenhum.
 *
 * `null` quer dizer NÃO ESCREVA. Existe por causa do disparo alvo (por
 * `message_ids`), que ignora o status atual de propósito: em 14/08/2026 um
 * redisparo releu dois arquivos JÁ casados e aprovados contra a lista que
 * aqueles mesmos arquivos tinham acabado de esvaziar, e rebaixou os dois para
 * `no_match`. O documento estava aprovado no pedido e a mensagem dizia que não
 * servia para nada — quem fosse auditar leria a história errada.
 */
export function waAiDocIntakeMarkForNoMatch(previousStatus?: string | null): 'no_match' | null {
  return String(previousStatus || '').trim() === 'matched' ? null : 'no_match';
}
