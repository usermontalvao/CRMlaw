// Quais linhas de conversa pertencem à MESMA pessoa.
//
// O WhatsApp entrega uma conversa por número do escritório: quem escreve para o
// nosso Comercial e para o nosso Atendimento vira duas linhas em
// `whatsapp_conversations` (chave única `instance_id + remote_jid`), e trocar de
// canal abre a linha do outro número em vez de mover a thread. Do lado de fora
// isso é verdade — são dois chats no aparelho do cliente. Do lado do escritório
// não: é uma pessoa só, um atendimento só, um histórico só.
//
// Este módulo faz a ponte entre as duas verdades: dada a conversa aberta, diz
// quais outras linhas são da mesma pessoa, para a thread ser montada como um
// histórico único. Sem imports de propósito — assim o teste roda direto no
// `node --test` sem arrastar a cadeia de módulos do app.

/** O mínimo que o agrupamento precisa saber de uma conversa. */
export interface ThreadIdentity {
  id: string;
  contact_phone?: string | null;
  remote_jid?: string | null;
  client_id?: string | null;
  /** 'closed' = atendimento encerrado. Decide quem representa a pessoa na lista. */
  status?: string | null;
}

/**
 * Reduz um telefone a dígitos e completa o DDI 55 quando veio sem ele.
 * Devolve '' quando não sobra um número plausível — string vazia nunca casa com
 * ninguém, que é o comportamento certo para lixo.
 */
export function threadPhoneDigits(input: string | null | undefined): string {
  let d = (input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 12 || d.length > 13) return '';
  return d;
}

/**
 * Chave de identidade do contato, tolerante ao 9º dígito.
 *
 * O mesmo celular aparece como 5565984046375 e 556584046375 dependendo de quando
 * a conversa nasceu; sem normalizar, a mesma pessoa se dividiria em dois grupos.
 * A forma canônica escolhida é a SEM o 9 — chegar nela é sempre remoção, nunca
 * palpite sobre qual dígito inserir.
 */
export function contactKey(c: ThreadIdentity): string | null {
  const d = threadPhoneDigits(c.contact_phone) || threadPhoneDigits((c.remote_jid || '').replace(/@.*/, ''));
  if (d) {
    const m = d.match(/^55(\d{2})(\d+)$/);
    if (m && m[2].length === 9 && m[2][0] === '9') return `p:55${m[1]}${m[2].slice(1)}`;
    return `p:${d}`;
  }
  // Contato sem telefone utilizável (entrou por @lid, por exemplo): o vínculo com
  // o cadastro é o que resta para reconhecer a pessoa.
  return c.client_id ? `c:${c.client_id}` : null;
}

/**
 * Colapsa a lista já ordenada em UMA linha por pessoa.
 *
 * O contato que escreveu para dois números do escritório aparecia duas vezes na
 * inbox, com o mesmo nome e a mesma foto — lido como duplicata, não como "dois
 * números". Aqui as linhas irmãs viram uma só, e o contador de não lidas do grupo
 * é somado na sobrevivente: quem olha a lista quer saber quantas mensagens a
 * PESSOA deixou, não por qual dos nossos números elas entraram.
 *
 * A ordem de entrada é preservada — quem chama já ordenou (mais recente no topo,
 * arquivo no fim), e a sobrevivente de cada grupo é a primeira que aparece.
 * `keepId` força a conversa aberta a ser a sobrevivente do grupo dela: colapsar
 * justo a linha que está na tela tiraria a thread do usuário debaixo dele.
 */
export function collapseContactThreads<T extends ThreadIdentity & { unread_count?: number }>(
  ordered: readonly T[],
  keepId?: string | null,
): T[] {
  // 1ª passada: agrupa mantendo a ordem de chegada de cada grupo.
  const groups = new Map<string, T[]>();
  const out: T[] = [];
  for (const c of ordered) {
    const key = contactKey(c);
    // Sem chave não há como afirmar que duas linhas são a mesma pessoa; passa
    // direto, que é mais seguro do que fundir contatos diferentes.
    if (!key) { out.push(c); continue; }
    const g = groups.get(key);
    if (g) g.push(c);
    else { groups.set(key, [c]); out.push(c); }
  }

  // 2ª passada: troca cada representante pela linha certa e soma as não lidas.
  return out.map(c => {
    const key = contactKey(c);
    const g = key ? groups.get(key) : null;
    if (!g || g.length < 2) return c;
    // Quem representa a pessoa na lista, em ordem de prioridade:
    //   1. a conversa aberta na tela (não se troca a thread debaixo do usuário);
    //   2. uma linha ATIVA, mesmo que outra tenha ficado à frente na ordenação;
    //   3. a primeira do grupo.
    //
    // O passo 2 não é preferência estética, é correção: sem ele, uma pessoa com um
    // atendimento vivo num canal e um encerrado em outro aparecia como "Encerrada"
    // sempre que a linha encerrada vencia a ordenação — a conversa que o atendente
    // acabara de reabrir voltava a parecer arquivada assim que ele clicava fora.
    const survivor = (keepId && g.find(x => x.id === keepId))
      || g.find(x => x.status !== 'closed')
      || g[0];
    const unread = g.reduce((sum, x) => sum + (x.unread_count ?? 0), 0);
    return unread === (survivor.unread_count ?? 0) ? survivor : { ...survivor, unread_count: unread };
  });
}

/**
 * Ids de TODAS as linhas da mesma pessoa, incluindo a própria conversa aberta.
 *
 * A conversa aberta vem sempre primeiro e sempre presente — mesmo que ela não
 * tenha telefone nem cliente para agrupar, a thread dela não pode sumir da tela
 * por causa de um agrupamento que não deu certo.
 */
export function siblingThreadIds(
  selected: ThreadIdentity | null | undefined,
  all: readonly ThreadIdentity[],
): string[] {
  if (!selected) return [];
  const key = contactKey(selected);
  if (!key) return [selected.id];
  const ids = [selected.id];
  for (const c of all) {
    if (c.id === selected.id) continue;
    if (contactKey(c) === key) ids.push(c.id);
  }
  return ids;
}
