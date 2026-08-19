/**
 * A LINHA DA LIGAÇÃO — qual número sai, e quem tem direito de sair por ele.
 *
 * Este é o SEGUNDO degrau da permissão de discar. O primeiro (`dialPermission`)
 * pergunta "esta pessoa trabalha com atendimento?"; aqui se pergunta "e por
 * qual número ela pode falar em nome do escritório?".
 *
 * O QUE É UMA LINHA. O serviço de voz conhece "sessões" — contas de WhatsApp
 * pareadas nele — e não sabe nada do CRM: para ele existe um `jid` e mais nada.
 * O CRM conhece "canais" (`whatsapp_instances`), com nome, número, dono e
 * regra de visibilidade. Uma LINHA é o encontro dos dois, e o encontro se dá
 * pelo TELEFONE: o número pareado no serviço de voz é o mesmo número cadastrado
 * como canal. Não há id em comum entre os dois mundos — e não deveria haver,
 * porque a conta de voz pode ser repareada sem o canal mudar.
 *
 * A REGRA DE AUTORIZAÇÃO, decidida com o escritório em 19/08/2026:
 *
 *   · ADMINISTRADOR fala por qualquer linha;
 *   · CANAL ABERTO (`visibility_mode = 'all'`) é do escritório inteiro — quem
 *     passou pelo primeiro degrau liga por ele;
 *   · CANAL RESTRITO exige estar na LISTA DE MEMBROS (`whatsapp_channel_members`).
 *
 * E uma diferença deliberada em relação a `wa_can_see_channel()`, que é a regra
 * que governa a INBOX: lá, ter uma conversa atribuída ou transferida no canal
 * também dá acesso. Aqui não. Receber uma conversa é receber trabalho; sair
 * ligando com o número do escritório é falar em nome dele. São direitos
 * diferentes, e foi essa a decisão B.
 *
 * LINHA QUE NÃO É CANAL NENHUM não bloqueia ninguém. Uma conta pareada no
 * serviço de voz cujo número não está cadastrado como canal é uma falha de
 * cadastro, não uma restrição — e tratá-la como restrição faria uma linha
 * esquecida no cadastro derrubar o telefone do escritório inteiro. Ela vale
 * como "linha do escritório": quem passou pelo primeiro degrau usa.
 *
 * PURO DE PROPÓSITO: nenhum import. Quem busca os dados é `callLinesData.ts`.
 */

/** Um canal do CRM, do jeito que a regra precisa dele. */
export interface ChannelRow {
  id: string;
  name: string | null;
  /** `phone_number`, como está no cadastro (com ou sem símbolos). */
  phone: string | null;
  /** `visibility_mode`: 'all' | 'restricted'. */
  visibility: string | null;
}

/** Uma conta pareada no serviço de voz, do jeito que a regra precisa dela. */
export interface SessionRow {
  id: string;
  name: string;
  jid: string;
  /** O telefone que o serviço informou, quando informou. */
  phone?: string | null;
  paired: boolean;
  state: string;
}

/**
 * Por que uma linha não pode ser usada agora. É o que a tela escreve.
 *
 *  · `not-member`  — o canal é restrito e a pessoa não está na lista;
 *  · `no-voice`    — o canal existe, mas nenhuma conta de voz foi pareada com
 *                    o número dele. É o caso do "Comercial" hoje;
 *  · `offline`     — a conta existe e está pareada, mas a conexão caiu.
 */
export type LineBlock = 'not-member' | 'no-voice' | 'offline';

/**
 * Uma linha: o CANAL, a conta de voz dele (quando existe) e o direito de usá-la.
 *
 * A lista é feita a partir dos CANAIS, não das contas de voz — e isso é uma
 * decisão, não um detalhe. Quem liga pensa em "ligar pelo Comercial", não em
 * "usar a sessão pareada"; e um canal sem voz precisa APARECER dizendo que não
 * tem voz, senão a pergunta "cadê a opção de trocar de canal?" não tem resposta
 * na tela. Uma lista feita só das contas pareadas mostraria uma linha só e
 * esconderia justamente o que falta fazer.
 */
export interface CallLine {
  /** Identidade da linha na lista: o canal quando há um, senão a conta. */
  key: string;
  /** A conta de voz que atende por este canal. `null` = canal sem voz. */
  sessionId: string | null;
  channelId: string | null;
  /** "Comercial", ou o nome que o serviço de voz deu à conta. */
  label: string;
  /** Só dígitos, pronto para formatar. Vazio quando não deu para descobrir. */
  phone: string;
  /** Dá para ligar por ela AGORA (tem conta pareada e conectada). */
  online: boolean;
  authorized: boolean;
  block: LineBlock | null;
}

/** Só os dígitos. O cadastro escreve o número de várias formas. */
export function digitsOf(value: string | null | undefined): string {
  return (value || '').replace(/\D+/g, '');
}

/**
 * O telefone escondido dentro de um JID.
 *
 * `5565984046375:12@s.whatsapp.net` → `5565984046375`. O sufixo depois dos dois
 * pontos é o número do APARELHO na conta multi-dispositivo, e um `@lid` não tem
 * telefone nenhum — nesse caso devolve vazio, e a linha fica sem número em vez
 * de ganhar um número inventado (ver `whatsapp/lid`).
 */
export function phoneFromJid(jid: string | null | undefined): string {
  const cru = (jid || '').trim();
  if (!cru || cru.includes('@lid')) return '';
  const antes = cru.split('@')[0]?.split(':')[0] ?? '';
  return digitsOf(antes);
}

/** O telefone da conta de voz: o que o serviço disse, ou o que o JID revela. */
export function sessionPhone(session: SessionRow): string {
  return digitsOf(session.phone) || phoneFromJid(session.jid);
}

/**
 * O número em forma canônica: 55 + DDD + número.
 *
 * Cópia PURA de `whatsapp/shared#normalizePhone` — não é descuido. Este módulo
 * não importa nada de propósito (é o que o deixa testável com `node --test`), e
 * `shared` traz o cliente do Supabase atrás dele. A cópia é vigiada pelos
 * testes dos dois lados, como as regras do assistente.
 */
function normalize(input: string): string {
  let d = digitsOf(input);
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  return d;
}

/**
 * O MESMO número, com e sem o nono dígito do celular.
 *
 * Isto não é refinamento: é o caso REAL da linha do escritório. O WhatsApp
 * reporta a conta pareada como `556584046375` — sem o 9 —, enquanto o canal
 * está cadastrado como `5565984046375`. Sem as duas formas, a linha nunca
 * encontra o canal dela, cai no caso "fora do cadastro" e a permissão por canal
 * simplesmente não acontece: todo mundo poderia ligar por qualquer linha.
 */
export function phoneVariants(input: string): string[] {
  const d = normalize(input);
  if (!d) return [];
  const out = new Set<string>([d]);
  const m = d.match(/^55(\d{2})(\d+)$/);
  if (m) {
    const [, ddd, resto] = m;
    if (resto.length === 9 && resto[0] === '9') out.add(`55${ddd}${resto.slice(1)}`);
    else if (resto.length === 8) out.add(`55${ddd}9${resto}`);
  }
  return Array.from(out);
}

/** Dois números são o mesmo telefone? (Com e sem o nono dígito.) */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const va = phoneVariants(a);
  if (va.length === 0) return false;
  const vb = new Set(phoneVariants(b));
  return va.some(v => vb.has(v));
}

/** O canal cujo número é este. */
export function channelForPhone(phone: string, channels: readonly ChannelRow[]): ChannelRow | null {
  if (!digitsOf(phone)) return null;
  return channels.find(c => samePhone(c.phone, phone)) ?? null;
}

/** Esta pessoa pode falar em nome deste canal? Ver o cabeçalho. */
export function canUseChannel(params: {
  channel: ChannelRow | null;
  isAdmin: boolean;
  /** Canais em que a pessoa está cadastrada como membro. */
  memberOf: ReadonlySet<string>;
}): boolean {
  if (params.isAdmin) return true;
  // Linha fora do cadastro: é do escritório, e o primeiro degrau já decidiu.
  if (!params.channel) return true;
  if ((params.channel.visibility || 'all') === 'all') return true;
  return params.memberOf.has(params.channel.id);
}

/**
 * As linhas que existem, com nome, com número e com direito.
 *
 * Sai um item por CANAL que a pessoa pode usar — tenha ele voz ou não — mais um
 * item para cada conta de voz que não corresponde a canal nenhum (a "linha do
 * escritório", que não bloqueia ninguém). Canais que a pessoa NÃO pode usar
 * entram na lista marcados: é como a tela consegue dizer "existe linha, mas não
 * é sua" em vez de simplesmente não mostrar nada.
 *
 * A ordem é a de utilidade: primeiro o que dá para usar agora, depois o que é
 * seu mas está sem voz, por último o que não é seu.
 */
export function buildLines(params: {
  sessions: readonly SessionRow[];
  channels: readonly ChannelRow[];
  isAdmin: boolean;
  memberOf: ReadonlySet<string>;
}): CallLine[] {
  const usadas = new Set<string>();

  const doCanal = params.channels.map<CallLine>(channel => {
    const conta = params.sessions.find(s => samePhone(sessionPhone(s), channel.phone)) ?? null;
    if (conta) usadas.add(conta.id);
    const online = !!conta && conta.paired && conta.state === 'open';
    const authorized = canUseChannel({ channel, isAdmin: params.isAdmin, memberOf: params.memberOf });
    return {
      key: channel.id,
      // Sem conta de voz não há por onde ligar — e uma linha que se oferece
      // como escolhível sem ter voz é um botão que não liga.
      sessionId: online && conta ? conta.id : null,
      channelId: channel.id,
      label: channel.name || 'Canal sem nome',
      phone: digitsOf(channel.phone),
      online,
      authorized,
      block: !authorized ? 'not-member' : (!conta ? 'no-voice' : (!online ? 'offline' : null)),
    };
  });

  // Conta pareada que não é canal nenhum: falha de cadastro, não restrição.
  const soltas = params.sessions
    .filter(s => !usadas.has(s.id))
    .map<CallLine>(session => {
      const online = session.paired && session.state === 'open';
      return {
        key: session.id,
        sessionId: online ? session.id : null,
        channelId: null,
        label: session.name || 'Linha do escritório',
        phone: sessionPhone(session),
        online,
        authorized: true,
        block: online ? null : 'offline',
      };
    });

  const peso = (l: CallLine) => (l.authorized && l.online ? 0 : l.authorized ? 1 : 2);
  return [...doCanal, ...soltas].sort((a, b) => peso(a) - peso(b));
}

/** A linha que o discador usa quando ninguém escolheu nada. */
export function defaultLine(
  lines: readonly CallLine[],
  preferred?: string | null,
): CallLine | null {
  const usavel = (l: CallLine) => l.authorized && l.online && !!l.sessionId;
  // A PREFERIDA MANDA, quando ainda dá para usá-la. É a diferença entre abrir o
  // discador pronto para ligar e abrir tendo de conferir, toda vez, por qual
  // número ele vai sair — que é o incômodo de quem tem mais de uma linha.
  if (preferred) {
    const escolhida = lines.find(l => l.key === preferred);
    if (escolhida && usavel(escolhida)) return escolhida;
  }
  return lines.find(usavel) ?? null;
}

/**
 * A linha que a FAIXA mostra quando não há nenhuma discável.
 *
 * Sem isto a faixa cairia num texto genérico ("Linha do escritório") toda vez
 * que a conta de voz oscilasse — que foi exatamente o que apareceu na tela do
 * escritório em 19/08. Melhor nomear o canal e dizer o que falta nele.
 */
export function displayLine(
  lines: readonly CallLine[],
  chosen: string | null,
  preferred?: string | null,
): CallLine | null {
  if (chosen) {
    const escolhida = lines.find(l => l.sessionId === chosen);
    if (escolhida) return escolhida;
  }
  return defaultLine(lines, preferred)
    // Nenhuma discável: mostra a preferida mesmo parada, que é a que a pessoa
    // espera ver, e o motivo do bloqueio explica o resto.
    ?? (preferred ? lines.find(l => l.key === preferred && l.authorized) : null)
    ?? lines.find(l => l.authorized)
    ?? lines[0]
    ?? null;
}

/** O que a faixa escreve para cada situação de bloqueio. */
export function lineBlockText(block: LineBlock | null, label: string): string {
  switch (block) {
    case 'not-member':
      return `A linha ${label} é restrita aos membros do canal. Peça acesso a um administrador.`;
    case 'no-voice':
      return `O canal ${label} ainda não tem voz: nenhuma conta de WhatsApp foi pareada com esse número no serviço de chamadas.`;
    case 'offline':
      return `A linha ${label} está fora do ar no momento — a conta de WhatsApp perdeu a conexão.`;
    default:
      return '';
  }
}

/** O recado de quem tem linha, mas não aquela. */
export const LINE_DENIED_MESSAGE = 'Você não tem permissão para ligar por esta linha.';
export function lineDeniedDetail(label: string): string {
  return `A linha ${label} é restrita aos membros do canal. Peça a um administrador para incluir você.`;
}
