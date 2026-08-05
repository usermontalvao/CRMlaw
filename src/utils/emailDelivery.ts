// Entrega de e-mail: o que acontece DEPOIS que o SMTP aceita a mensagem.
//
// O envio pelo CRM é síncrono só até a ponte aceitar; a recusa do servidor de
// destino chega minutos depois como um "bounce" (DSN) na caixa de entrada,
// assinado por MAILER-DAEMON. Sem tratamento, isso vira mais um e-mail
// incompreensível no meio da lista e o remetente nunca descobre que a mensagem
// não chegou.
//
// Este módulo é puro (sem imports) de propósito: roda no navegador e no
// `node --test` sem cadeia de dependências.

export type BounceSeverity = 'hard' | 'soft' | 'unknown';

export interface BounceReport {
  /** Endereços que o servidor de destino recusou. */
  failedRecipients: string[];
  /** Código estendido (RFC 3463), ex.: "5.1.1". */
  statusCode: string | null;
  /** `hard` = não adianta reenviar; `soft` = falha temporária. */
  severity: BounceSeverity;
  /** Explicação em português para mostrar ao usuário. */
  reason: string;
  /** O que fazer a respeito — null quando não há ação óbvia. */
  hint: string | null;
  /**
   * Rótulo do botão de reenvio, coerente com a causa: só fala em "corrigir o
   * endereço" quando o endereço é mesmo o problema. `null` esconde o botão
   * (falha temporária — o servidor tenta de novo sozinho).
   */
  retryLabel: string | null;
}

export interface BounceReportWithOrigin extends BounceReport {
  /** Assunto da mensagem original, quando o DSN traz os cabeçalhos dela. */
  originalSubject: string | null;
  /** Message-ID original — a ligação mais confiável com o e-mail enviado. */
  originalMessageId: string | null;
}

export interface BounceInput {
  fromAddress?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
}

const DAEMON_LOCAL_PARTS = new Set([
  'mailer-daemon',
  'postmaster',
  'mail-daemon',
  'mailerdaemon',
  'double-bounce',
]);

const BOUNCE_SUBJECT_RE =
  /(undelivered\s+mail|delivery\s+status\s+notification|mail\s+delivery\s+(failed|system)|delivery\s+(has\s+)?failed|returned\s+to\s+sender|undeliverable|falha\s+na\s+entrega|não\s+foi\s+entregue|devolu(ç|c)ão\s+de\s+mensagem)/i;

// Campos do relatório DSN (RFC 3464). A presença deles é o sinal mais forte:
// nenhum e-mail humano traz "Final-Recipient:" e "Diagnostic-Code:".
const DSN_FIELD_RE = /^\s*(Final-Recipient|Original-Recipient|Diagnostic-Code|Reporting-MTA)\s*:/im;
const DSN_ACTION_FAILED_RE = /^\s*Action\s*:\s*(failed|delayed)\s*$/im;

function localPartOf(address: string): string {
  return address.split('@')[0]?.trim().toLowerCase() ?? '';
}

/** Extrai o endereço de "Nome <a@b.com>" ou de "a@b.com". */
export function addressOf(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function collectText(input: BounceInput): string {
  const text = (input.bodyText ?? '').trim();
  if (text) return text;
  return htmlToText(input.bodyHtml ?? '');
}

function uniqueLower(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function extractFailedRecipients(text: string): string[] {
  const found: string[] = [];

  // "Final-Recipient: rfc822; alguem@dominio.com" (o campo canônico do DSN).
  for (const m of text.matchAll(/^\s*(?:Final|Original)-Recipient\s*:\s*(?:rfc822\s*;)?\s*([^\s<>,;]+@[^\s<>,;]+)/gim)) {
    found.push(m[1]);
  }
  // Cabeçalho que alguns servidores mandam solto.
  for (const m of text.matchAll(/^\s*X-Failed-Recipients\s*:\s*(.+)$/gim)) {
    for (const part of m[1].split(/[,;]+/)) {
      const address = addressOf(part).trim();
      if (address.includes('@')) found.push(address);
    }
  }
  // Corpo em prosa do Postfix: "<alguem@dominio.com>: host ... said: 550 ...".
  if (!found.length) {
    for (const m of text.matchAll(/<([^\s<>@]+@[^\s<>]+)>\s*:/g)) {
      found.push(m[1]);
    }
  }

  // O DSN repete o próprio remetente em Reporting-MTA/X-Postfix-Sender; esses
  // não são destinatários recusados e já ficam de fora pelos padrões acima.
  return uniqueLower(found);
}

function extractStatusCode(text: string): string | null {
  const status = text.match(/^\s*Status\s*:\s*([245]\.\d{1,3}\.\d{1,3})/im);
  if (status) return status[1];
  // "smtp; 550-5.1.1 The email account that you tried to reach does not exist"
  const enhanced = text.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/);
  if (enhanced) return enhanced[1];
  // Só o código SMTP básico: 550 vira 5.x.x genérico.
  const basic = text.match(/\b(5\d{2}|4\d{2})[\s-]/);
  if (basic) return `${basic[1][0]}.0.0`;
  return null;
}

interface ReasonCopy {
  reason: string;
  hint: string | null;
  retryLabel: string | null;
}

const FIX_ADDRESS = 'Reenviar corrigindo o endereço';
const RESEND = 'Escrever de novo para este endereço';

function describe(statusCode: string | null, text: string): ReasonCopy {
  const code = statusCode ?? '';
  const lower = text.toLowerCase();

  if (/^5\.1\.[16]$/.test(code) || /does not exist|no such user|user unknown|recipient not found|unknown recipient/.test(lower)) {
    return {
      reason: 'O endereço não existe no servidor de destino.',
      hint: 'Confira letra por letra se há erro de digitação e confirme o endereço com o destinatário.',
      retryLabel: FIX_ADDRESS,
    };
  }
  if (code === '5.2.2' || /mailbox full|quota exceeded|over quota/.test(lower)) {
    return {
      reason: 'A caixa do destinatário está cheia.',
      hint: 'Avise o destinatário por outro canal e tente de novo depois.',
      retryLabel: RESEND,
    };
  }
  if (code === '5.4.4' || code === '5.1.2' || /domain not found|host not found|no such domain|unrouteable address/.test(lower)) {
    return {
      reason: 'O domínio do destinatário não existe ou não recebe e-mail.',
      hint: 'Confira a parte depois do @ do endereço.',
      retryLabel: FIX_ADDRESS,
    };
  }
  if (/^5\.7\./.test(code) || /blocked|rejected due to|spam|policy|blacklist|not authorized/.test(lower)) {
    return {
      reason: 'O servidor de destino recusou a mensagem por política (bloqueio/antispam).',
      hint: 'Reveja anexos e links da mensagem, ou fale com o destinatário para liberar o remetente.',
      retryLabel: RESEND,
    };
  }
  if (code.startsWith('4.')) {
    return {
      reason: 'Falha temporária: o servidor de destino não aceitou a mensagem agora.',
      hint: 'O servidor de envio costuma tentar de novo sozinho nas próximas horas.',
      // Sem botão: reenviar na mão só duplica o que o servidor já vai retentar.
      retryLabel: null,
    };
  }
  return {
    reason: 'O servidor de destino recusou a mensagem.',
    hint: 'Confira o endereço e o conteúdo do relatório abaixo antes de reenviar.',
    retryLabel: RESEND,
  };
}

/**
 * Cabeçalhos da mensagem original, que o DSN anexa depois do relatório. São a
 * ponte entre a devolução e o e-mail que está em "Enviados".
 */
function extractOrigin(text: string): { originalSubject: string | null; originalMessageId: string | null } {
  // Ignora o "Subject:" do próprio aviso: o bloco original vem depois do
  // relatório, então vale a ÚLTIMA ocorrência.
  const subjects = [...text.matchAll(/^\s*Subject\s*:\s*(.+?)\s*$/gim)].map((m) => m[1]);
  const messageIds = [...text.matchAll(/^\s*Message-ID\s*:\s*<([^>]+)>/gim)].map((m) => m[1]);
  return {
    originalSubject: subjects.length ? subjects[subjects.length - 1] : null,
    originalMessageId: messageIds.length ? messageIds[messageIds.length - 1] : null,
  };
}

/**
 * Reconhece um aviso de devolução (DSN) e traduz o motivo. Retorna `null`
 * quando a mensagem é um e-mail comum.
 */
export function detectBounce(input: BounceInput): BounceReportWithOrigin | null {
  const text = collectText(input);
  if (!text) return null;

  const from = addressOf(input.fromAddress ?? '').toLowerCase();
  const fromDaemon = !!from && DAEMON_LOCAL_PARTS.has(localPartOf(from));
  const subjectHit = BOUNCE_SUBJECT_RE.test(input.subject ?? '');
  const hasDsnFields = DSN_FIELD_RE.test(text);
  const actionFailed = DSN_ACTION_FAILED_RE.test(text);

  // Um sinal isolado é fraco demais (um cliente pode escrever "delivery
  // failed" no assunto). Exige-se ou o relatório DSN estruturado, ou o
  // MAILER-DAEMON somado a um segundo indício.
  const isBounce = hasDsnFields || (fromDaemon && (subjectHit || actionFailed));
  if (!isBounce) return null;

  const statusCode = extractStatusCode(text);
  const severity: BounceSeverity = statusCode
    ? statusCode.startsWith('5')
      ? 'hard'
      : statusCode.startsWith('4')
        ? 'soft'
        : 'unknown'
    : 'unknown';
  const { reason, hint, retryLabel } = describe(statusCode, text);

  return {
    failedRecipients: extractFailedRecipients(text),
    statusCode,
    severity,
    reason,
    hint,
    retryLabel,
    ...extractOrigin(text),
  };
}

// ---------------------------------------------------------------------------
// Ligar a devolução ao e-mail que está em "Enviados".
//
// Sem isso a devolução fica só na caixa de entrada e a mensagem enviada segue
// com cara de entregue — que é justamente como o erro passa despercebido.
// ---------------------------------------------------------------------------

export interface BounceRecord {
  /** Id da mensagem de devolução (para abrir o relatório completo). */
  bounceMessageId: string;
  /** Quando a devolução chegou (ISO). */
  receivedAt: string | null;
  report: BounceReportWithOrigin;
}

export interface SentMessageRef {
  id: string;
  /** Message-ID do e-mail enviado, como gravado no cabeçalho. */
  messageId?: string | null;
  subject?: string | null;
  /** Conteúdo bruto dos campos to/cc/bcc. */
  recipients?: (string | null | undefined)[];
  /** Quando foi enviado (ISO). */
  sentAt?: string | null;
}

function normalizeMessageId(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^<|>$/g, '').toLowerCase();
}

function recipientSet(sent: SentMessageRef): Set<string> {
  const out = new Set<string>();
  for (const field of sent.recipients ?? []) {
    if (!field) continue;
    for (const part of field.split(/[,;]+/)) {
      const address = addressOf(part).trim().toLowerCase();
      if (address.includes('@')) out.add(address);
    }
  }
  return out;
}

function timeOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

/** Janela em que uma devolução ainda é atribuída a um envio: 14 dias. */
export const BOUNCE_MATCH_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Casa cada devolução com a mensagem enviada correspondente. Retorna um mapa
 * `id da mensagem enviada -> devolução`.
 *
 * A ordem das pistas vai da mais forte para a mais fraca: Message-ID original,
 * depois destinatário + assunto, e por fim destinatário + o envio mais recente
 * antes da devolução. Sem destinatário em comum não há palpite — é melhor não
 * marcar do que marcar a mensagem errada.
 */
export function matchBouncesToSent(
  bounces: BounceRecord[],
  sent: SentMessageRef[],
): Map<string, BounceRecord> {
  const matches = new Map<string, BounceRecord>();
  const byMessageId = new Map<string, SentMessageRef>();
  for (const message of sent) {
    const key = normalizeMessageId(message.messageId);
    if (key) byMessageId.set(key, message);
  }

  for (const bounce of bounces) {
    const bounceTime = timeOf(bounce.receivedAt);

    // 1) Message-ID original: identidade, não palpite.
    const originalId = normalizeMessageId(bounce.report.originalMessageId);
    const byId = originalId ? byMessageId.get(originalId) : undefined;
    if (byId) {
      matches.set(byId.id, bounce);
      continue;
    }

    const failed = new Set(bounce.report.failedRecipients.map((a) => a.toLowerCase()));
    if (!failed.size) continue;

    const candidates = sent.filter((message) => {
      const recipients = recipientSet(message);
      if (![...failed].some((address) => recipients.has(address))) return false;
      const sentTime = timeOf(message.sentAt);
      if (bounceTime == null || sentTime == null) return true;
      // O envio precede a devolução e está dentro da janela.
      return sentTime <= bounceTime && bounceTime - sentTime <= BOUNCE_MATCH_WINDOW_MS;
    });
    if (!candidates.length) continue;

    // 2) Assunto original bate: escolhe direto.
    const subject = (bounce.report.originalSubject ?? '').trim().toLowerCase();
    const bySubject = subject
      ? candidates.filter((message) => (message.subject ?? '').trim().toLowerCase() === subject)
      : [];
    const pool = bySubject.length ? bySubject : candidates;

    // 3) O envio mais recente antes da devolução.
    const chosen = pool.reduce((best, message) => {
      const bestTime = timeOf(best.sentAt) ?? -Infinity;
      const time = timeOf(message.sentAt) ?? -Infinity;
      return time > bestTime ? message : best;
    }, pool[0]);

    // Uma devolução já atribuída não rouba o lugar de outra mais específica.
    if (!matches.has(chosen.id)) matches.set(chosen.id, bounce);
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Prevenção: pegar o erro de digitação ANTES de enviar.
// ---------------------------------------------------------------------------

// Domínios grandes escritos errado. A chave é o erro; o valor, o certo.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.con': 'gmail.com',
  'gmail.comm': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmail.om': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'hotmail.co': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmail.cm': 'hotmail.com',
  'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outllok.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'outlook.co': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'yahooo.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'iclod.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'uol.com': 'uol.com.br',
  'bol.com': 'bol.com.br',
  'terra.com': 'terra.com.br',
  'globo.com.br': 'globo.com',
  'com.br.br': 'com.br',
};

export interface AddressIssue {
  /** Endereço como o usuário digitou. */
  address: string;
  /** Sugestão de correção, quando dá para deduzir. */
  suggestion: string | null;
  /** Texto pronto para o aviso do compose. */
  message: string;
}

/**
 * Aponta endereços com cara de erro de digitação. Só reclama do que dá para
 * afirmar sem adivinhar — domínio conhecido escrito errado, pontuação sobrando,
 * TLD ausente. Um erro na parte antes do @ (`fulanoo@gmail.com`) é
 * indetectável aqui: para esses vale o aviso de "endereço nunca usado".
 */
export function findAddressIssue(raw: string): AddressIssue | null {
  const address = addressOf(raw).trim();
  if (!address || !address.includes('@')) return null;

  const lower = address.toLowerCase();
  const atCount = (lower.match(/@/g) ?? []).length;
  if (atCount > 1) {
    return { address, suggestion: null, message: `"${address}" tem mais de um @.` };
  }

  const [local, domain = ''] = lower.split('@');

  if (/\.\./.test(lower) || local.startsWith('.') || local.endsWith('.') || domain.startsWith('.') || domain.startsWith('-')) {
    return { address, suggestion: null, message: `"${address}" tem ponto sobrando ou fora de lugar.` };
  }
  if (domain.endsWith('.')) {
    const suggestion = `${local}@${domain.replace(/\.+$/, '')}`;
    return { address, suggestion, message: `"${address}" termina em ponto — você quis dizer "${suggestion}"?` };
  }
  if (!domain.includes('.')) {
    return { address, suggestion: null, message: `"${address}" não tem domínio completo (falta ".com", ".com.br"…).` };
  }

  const fixedDomain = DOMAIN_TYPOS[domain];
  if (fixedDomain) {
    const suggestion = `${local}@${fixedDomain}`;
    return { address, suggestion, message: `"${address}" parece erro de digitação — você quis dizer "${suggestion}"?` };
  }

  return null;
}

/** Roda `findAddressIssue` numa lista de destinatários. */
export function findAddressIssues(addresses: string[]): AddressIssue[] {
  const out: AddressIssue[] = [];
  const seen = new Set<string>();
  for (const raw of addresses) {
    const issue = findAddressIssue(raw);
    if (!issue) continue;
    const key = issue.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}
