// A CHAMADA PERDIDA QUE FICA NA TELA — as regras, sem tela nenhuma em volta.
//
// O CRM já sabia registrar a ligação perdida (ela vira linha no histórico e
// distintivo na aba de Ligações), mas as duas coisas exigem que alguém ABRA a
// inbox para descobrir que perdeu uma chamada. Quem estava no processo, na
// agenda ou no editor de petições não descobria — e uma ligação perdida às 9h
// que só aparece à tarde é, na prática, um cliente que ligou para o escritório
// do lado.
//
// O aviso que faltava é o do CELULAR: a chamada perdida FICA na tela, em
// qualquer módulo, até alguém dizer que viu. Não é um toast (que some sozinho
// em cinco segundos, quase sempre enquanto a pessoa está falando com outra), e
// não é um contador escondido atrás de um clique.
//
// Três decisões moram aqui, e as três são de regra:
//
//  1. O QUE ENTRA. Só chamada RECEBIDA que ninguém atendeu. Recusada não entra
//     (recusar é um ato: quem recusou viu), atendida muito menos.
//  2. O QUE SAI. A janela de tempo (uma perdida de anteontem não é aviso, é
//     histórico), o que a pessoa já dispensou e o que já foi dado por visto na
//     aba de Ligações — as duas marcas precisam concordar, senão o escritório
//     fica com dois avisos discordando sobre a mesma ligação.
//  3. COMO SE AGRUPA. Quem ligou três vezes seguidas é UMA linha com "3
//     chamadas", como no celular: três cartões da mesma pessoa não informam
//     três vezes mais, só ocupam a tela três vezes mais.
//
// PURO DE PROPÓSITO: nenhum import de runtime (ver o cabeçalho de
// `callHistory.ts`). É o que permite testar com `node --test`.

/** Uma chamada perdida como o aviso precisa dela. */
export interface MissedCall {
  /** `callId` do WaCalls — é ele que identifica a chamada em todo o CRM. */
  callId: string;
  /** Telefone em dígitos. VAZIO quando a chamada chegou só com o apelido. */
  phone: string;
  /** O apelido interno do WhatsApp (`<n>@lid`). NUNCA é telefone. */
  lid: string | null;
  /** Nome do contato, quando o CRM reconheceu quem ligou. */
  name: string | null;
  /** Rosto já assinado (chamada que tocou nesta aba). Pode expirar. */
  avatarUrl: string | null;
  /** Caminho do rosto no bucket (chamada lida do histórico). Assinado na hora. */
  avatarPath: string | null;
  conversationId: string | null;
  clientId: string | null;
  /** Início da chamada, em ms. */
  startedAt: number;
}

/**
 * Até quando uma perdida ainda é AVISO.
 *
 * Doze horas cobre a jornada inteira — quem chega às 8h vê a ligação das 7h50,
 * e quem volta do almoço vê a da manhã. Passado isso ela continua no histórico
 * (lá ela é vermelha para sempre), mas deixa de aparecer sozinha na tela: um
 * aviso que nunca sai vira paisagem, e paisagem ninguém lê.
 */
export const MISSED_CALL_WINDOW_MS = 12 * 60 * 60_000;

/** Quantas perdidas o aviso guarda. O resto vira "+N" e mora no histórico. */
export const MISSED_CALL_MAX = 12;

/** Quantos contatos o cartão desenha antes de resumir o resto numa linha só. */
export const MISSED_CALL_VISIBLE_GROUPS = 3;

export interface MissedCallsMergeOptions {
  now: number;
  /** Janela de tempo. Padrão: `MISSED_CALL_WINDOW_MS`. */
  windowMs?: number;
  /** Teto da lista. Padrão: `MISSED_CALL_MAX`. */
  max?: number;
  /** `callId`s que a pessoa já dispensou nesta mesa. */
  dismissed?: readonly string[];
  /** Marca de "já vi as ligações até aqui" (ms). Ver `callsSeen.ts`. */
  seenUntil?: number | null;
}

const temValor = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim() !== '';

/**
 * A MESMA chamada, vista duas vezes, é uma só — e a segunda vista costuma
 * saber mais.
 *
 * A ligação chega ao aviso por dois caminhos: o evento do WaCalls, na hora em
 * que o telefone para de tocar (rápido, e às vezes ainda sem nome nenhum,
 * porque a consulta do contato não voltou), e a releitura do histórico (mais
 * lenta, com nome e rosto). Quem chega depois COMPLETA quem chegou antes, em
 * vez de substituir: o nome que o primeiro já tinha não pode ser apagado por
 * uma linha do banco que veio sem ele.
 */
function completar(base: MissedCall, novo: MissedCall): MissedCall {
  return {
    callId: base.callId,
    phone: temValor(novo.phone) ? novo.phone : base.phone,
    lid: temValor(novo.lid) ? novo.lid : base.lid,
    name: temValor(novo.name) ? novo.name : base.name,
    avatarUrl: temValor(novo.avatarUrl) ? novo.avatarUrl : base.avatarUrl,
    avatarPath: temValor(novo.avatarPath) ? novo.avatarPath : base.avatarPath,
    conversationId: temValor(novo.conversationId) ? novo.conversationId : base.conversationId,
    clientId: temValor(novo.clientId) ? novo.clientId : base.clientId,
    // O horário do primeiro registro manda: é o instante em que o telefone
    // tocou nesta mesa. O do banco pode chegar arredondado pelo servidor.
    startedAt: Number.isFinite(base.startedAt) ? base.startedAt : novo.startedAt,
  };
}

/**
 * Junta o que já estava na tela com o que acabou de chegar, e devolve o que o
 * aviso deve mostrar AGORA.
 *
 * É aqui que as três regras do cabeçalho viram uma lista: dedupe por `callId`,
 * corte pela janela de tempo, corte pelo que já foi visto ou dispensado, mais
 * recente primeiro e teto no fim.
 */
export function mergeMissedCalls(
  current: readonly MissedCall[],
  incoming: readonly MissedCall[],
  options: MissedCallsMergeOptions,
): MissedCall[] {
  const janela = options.windowMs ?? MISSED_CALL_WINDOW_MS;
  const teto = options.max ?? MISSED_CALL_MAX;
  const dispensadas = new Set(options.dismissed ?? []);
  const marca = typeof options.seenUntil === 'number' && Number.isFinite(options.seenUntil)
    ? options.seenUntil
    : null;

  const porChamada = new Map<string, MissedCall>();
  for (const call of [...current, ...incoming]) {
    if (!call || !call.callId) continue;
    const anterior = porChamada.get(call.callId);
    porChamada.set(call.callId, anterior ? completar(anterior, call) : call);
  }

  return Array.from(porChamada.values())
    .filter(c => {
      if (!Number.isFinite(c.startedAt)) return false;
      if (dispensadas.has(c.callId)) return false;
      if (options.now - c.startedAt > janela) return false;
      // Do futuro (relógio da máquina errado) também não: um aviso que nunca
      // envelhece nunca sairia da tela.
      if (c.startedAt - options.now > 60_000) return false;
      if (marca !== null && c.startedAt <= marca) return false;
      return true;
    })
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, teto);
}

/**
 * Quanto tempo uma chamada tem para APARECER no registro antes de o cartão
 * cobrar a presença dela. Ela entra no aviso pelo evento local, no instante em
 * que o telefone para de tocar, e só depois vira linha no banco.
 */
export const MISSED_CALL_RECONCILE_GRACE_MS = 3 * 60_000;

/**
 * O QUE DEIXOU DE SER PERDIDA SAI DO CARTÃO.
 *
 * O aviso só sabia somar: uma chamada entrava e ficava até a janela de 12h
 * fechar, mesmo que o registro do escritório passasse a dizer outra coisa
 * sobre ela. Foi o que aconteceu com as ligações recusadas no botão vermelho —
 * gravadas como perdidas por engano (ver `outcomeFromEndReason`), corrigidas no
 * banco depois, e ainda assim voltando à tela a cada abertura do CRM porque
 * viviam no armazenamento do navegador.
 *
 * A comparação só vale quando a releitura cobriu a janela INTEIRA
 * (`completa`): o registro vem com teto, e sumir da lista por causa do teto não
 * é sumir da lista por ter deixado de ser perdida.
 */
export function reconcileMissedCalls(
  current: readonly MissedCall[],
  aindaPerdidas: ReadonlySet<string>,
  options: { now: number; completa: boolean; graceMs?: number },
): MissedCall[] {
  if (!options.completa) return [...current];
  const carencia = options.graceMs ?? MISSED_CALL_RECONCILE_GRACE_MS;
  return current.filter(c => {
    if (aindaPerdidas.has(c.callId)) return true;
    // Acabou de acontecer: o registro ainda pode estar a caminho.
    return options.now - c.startedAt <= carencia;
  });
}

/**
 * Quem ligou — a chave que junta as ligações da MESMA pessoa.
 *
 * O telefone manda. Sem telefone, o apelido interno serve de chave (ele não
 * identifica ninguém para quem lê a tela, mas identifica para o agrupamento:
 * duas chamadas do mesmo LID são da mesma pessoa). Sem os dois, cada chamada é
 * ela mesma — é o que garante que uma anônima nunca engula outra.
 */
export function missedCallPeerKey(call: MissedCall): string {
  const digitos = (call.phone || '').replace(/\D/g, '');
  if (digitos) return `tel:${digitos}`;
  if (temValor(call.lid)) return `lid:${call.lid}`;
  return `call:${call.callId}`;
}

export interface MissedCallGroup {
  key: string;
  /** A chamada mais recente do grupo — é dela que saem nome, rosto e hora. */
  call: MissedCall;
  /** Quantas vezes esta pessoa ligou dentro da janela. */
  count: number;
  /** Todas as chamadas do grupo: dispensar a linha dispensa todas. */
  callIds: string[];
}

/** Uma linha por pessoa, a mais recente na frente. */
export function groupMissedCalls(calls: readonly MissedCall[]): MissedCallGroup[] {
  const grupos = new Map<string, MissedCallGroup>();
  for (const call of calls) {
    const key = missedCallPeerKey(call);
    const grupo = grupos.get(key);
    if (!grupo) {
      grupos.set(key, { key, call, count: 1, callIds: [call.callId] });
      continue;
    }
    grupo.count += 1;
    grupo.callIds.push(call.callId);
    // A mais recente é a cara do grupo (e a que costuma ter mais dados).
    if (call.startedAt > grupo.call.startedAt) grupo.call = call;
  }
  return Array.from(grupos.values()).sort((a, b) => b.call.startedAt - a.call.startedAt);
}

/** O título do cartão. Singular e plural escritos por extenso, sem "(s)". */
export function missedCallsHeadline(total: number): string {
  return total === 1 ? 'Chamada perdida' : `${total} chamadas perdidas`;
}

/** "3 chamadas" — o contador da linha de quem insistiu. Vazio para uma só. */
export function missedCallRepeatLabel(count: number): string {
  return count > 1 ? `${count} chamadas` : '';
}

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

/**
 * Quando foi — do jeito que o celular escreve.
 *
 * Minutos enquanto a ligação é recente (é a informação que muda o que se faz:
 * "há 2 min" pede retorno agora), relógio depois disso, e o dia junto quando
 * não foi hoje. Sem "há 7 horas": para uma ligação da manhã, o que interessa é
 * a hora em que ela tocou, não a conta.
 */
export function formatMissedCallTime(startedAt: number, now: number): string {
  if (!Number.isFinite(startedAt)) return '';
  const diff = now - startedAt;
  if (diff < 60_000) return 'agora mesmo';
  if (diff < 60 * 60_000) return `há ${Math.floor(diff / 60_000)} min`;

  const d = new Date(startedAt);
  const hora = `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
  const hoje = new Date(now);
  const mesmoDia = d.getFullYear() === hoje.getFullYear()
    && d.getMonth() === hoje.getMonth()
    && d.getDate() === hoje.getDate();
  if (mesmoDia) return hora;

  const ontem = new Date(now - 24 * 60 * 60_000);
  const foiOntem = d.getFullYear() === ontem.getFullYear()
    && d.getMonth() === ontem.getMonth()
    && d.getDate() === ontem.getDate();
  if (foiOntem) return `ontem ${hora}`;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${hora}`;
}

/**
 * Lê a lista guardada no navegador. Desconfia de tudo.
 *
 * É ela que faz o aviso sobreviver ao F5 — sem isso, recarregar a página
 * apagaria a chamada perdida que ninguém viu, que é justamente o contrário do
 * que o aviso existe para fazer. Qualquer linha estranha (sem `callId`, sem
 * horário) é descartada em silêncio: um aviso a menos é melhor que uma tela
 * quebrada.
 */
export function parseStoredMissedCalls(raw: string | null): MissedCall[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const lista: MissedCall[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const callId = typeof row.callId === 'string' ? row.callId : '';
    const startedAt = typeof row.startedAt === 'number' ? row.startedAt : NaN;
    if (!callId || !Number.isFinite(startedAt)) continue;
    const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
    lista.push({
      callId,
      phone: typeof row.phone === 'string' ? row.phone : '',
      lid: texto(row.lid),
      name: texto(row.name),
      avatarUrl: texto(row.avatarUrl),
      avatarPath: texto(row.avatarPath),
      conversationId: texto(row.conversationId),
      clientId: texto(row.clientId),
      startedAt,
    });
  }
  return lista;
}

/**
 * As dispensadas guardadas — `callId` e quando foram dispensadas.
 *
 * Precisam de validade: sem ela, a lista cresceria para sempre no navegador de
 * quem atende o telefone o dia inteiro. Passada a janela, a chamada já não
 * seria mostrada de qualquer jeito, então lembrar que ela foi dispensada
 * deixou de ter uso.
 */
export interface DismissedMissedCall { callId: string; at: number }

export function parseStoredDismissed(raw: string | null): DismissedMissedCall[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const lista: DismissedMissedCall[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.callId !== 'string' || !row.callId) continue;
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) continue;
    lista.push({ callId: row.callId, at: row.at });
  }
  return lista;
}

/** Esquece o que já passou da validade (e não deixa a lista crescer sem fim). */
export function pruneDismissed(
  dismissed: readonly DismissedMissedCall[],
  now: number,
  windowMs: number = MISSED_CALL_WINDOW_MS,
): DismissedMissedCall[] {
  const vivas = dismissed.filter(d => now - d.at <= windowMs * 2);
  // Mesmo dentro da validade, um teto: o navegador não é banco de dados.
  return vivas.slice(-200);
}
