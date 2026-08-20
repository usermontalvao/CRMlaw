// A MEMÓRIA CURTA DO MÓDULO WHATSAPP — o que sobrevive entre uma abertura e
// outra do widget.
//
// O módulo WhatsApp é montado e DESMONTADO o tempo todo: o painel flutuante usa
// `{open && …}`, então fechar joga o componente fora e abrir constrói tudo de
// novo. E o bootstrap dele pede onze coisas ao banco — conversas, canais,
// setores, roteamento, equipe, preferências, membros por setor, horário
// comercial, configuração do módulo, alertas de reconexão. Onze idas a São
// Paulo antes de a caixa de entrada existir na tela.
//
// Só que dez dessas onze quase nunca mudam. Setor, equipe, canal e horário
// comercial são CADASTRO: mexe-se neles nas Configurações, uma vez por mês. O
// atendente, esse, abre e fecha o painel quarenta vezes por dia — e pagava a
// viagem inteira em cada uma.
//
// Aqui o dado fica guardado na aba. Reabrir PINTA na hora, com o que já se
// sabia, e a busca continua acontecendo por baixo: o que voltar diferente
// entra em seguida, sem que ninguém tenha esperado por ele. É a diferença
// entre "abriu e carregou" e "abriu".
//
// ── O QUE ISTO NÃO É ─────────────────────────────────────────────────────────
//
// Não é cache de verdade — não tem invalidação, não tem tamanho máximo, não
// atravessa o recarregar da página. É memória de aba, e de propósito: a
// revalidação acontece em TODA montagem, então o dado velho vive o tempo de uma
// ida ao banco. Nada aqui deve guardar o que muda sozinho (mensagem, contador,
// presença) — para isso existe o realtime.
//
// ── POR QUE A CHAVE CARREGA O USUÁRIO ────────────────────────────────────────
//
// "A equipe", "meus canais" e "minhas preferências" são recortes do RLS: o que
// eu enxergo não é o que a Michele enxerga. Trocar de conta sem recarregar a
// página existe (o CRM tem tela de bloqueio e reautenticação), e sem o id do
// usuário na chave a segunda pessoa a entrar veria, por um instante, a lista
// da primeira.

interface Entrada {
  valor: unknown;
  em: number;
}

const MEMORIA = new Map<string, Entrada>();

/** Acima disto o valor guardado nem é entregue: é velho demais para valer a pena. */
const VALIDADE_MS = 30 * 60 * 1000;

/**
 * Entrega o que já se sabe (se houver) e busca de novo por baixo.
 *
 * `aplicar` pode ser chamado DUAS vezes: uma com o valor guardado, na hora, e
 * outra com o valor fresco, quando ele chegar. Quem usa precisa aguentar isso —
 * na prática são todos `setState`, que é exatamente o caso de uso.
 *
 * Erro na revalidação não apaga o que estava guardado: uma queda de rede não é
 * motivo para esvaziar a tela de quem está trabalhando.
 */
export function swrWa<T>(
  usuarioId: string | null | undefined,
  chave: string,
  buscar: () => Promise<T>,
  aplicar: (valor: T) => void,
): void {
  const k = `${usuarioId ?? 'anon'}:${chave}`;
  const guardado = MEMORIA.get(k);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) {
    aplicar(guardado.valor as T);
  }
  buscar()
    .then((valor) => {
      MEMORIA.set(k, { valor, em: Date.now() });
      aplicar(valor);
    })
    .catch(() => {/* mantém o que estava guardado */});
}

/** O que está guardado para esta chave, sem disparar busca nenhuma. */
export function lidoDaMemoriaWa<T>(usuarioId: string | null | undefined, chave: string): T | undefined {
  const guardado = MEMORIA.get(`${usuarioId ?? 'anon'}:${chave}`);
  if (!guardado || Date.now() - guardado.em >= VALIDADE_MS) return undefined;
  return guardado.valor as T;
}

/** Guarda um valor que já veio por outro caminho (a lista recarregada pelo realtime, por exemplo). */
export function guardaNaMemoriaWa(usuarioId: string | null | undefined, chave: string, valor: unknown): void {
  MEMORIA.set(`${usuarioId ?? 'anon'}:${chave}`, { valor, em: Date.now() });
}

/** Esquece tudo. Chamado na saída da conta — ver o efeito de logout do App. */
export function limpaMemoriaWa(): void {
  MEMORIA.clear();
}
