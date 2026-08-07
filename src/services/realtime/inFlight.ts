/**
 * Compartilhamento de requisições idênticas em voo.
 *
 * Os logs da API mostravam a MESMA consulta — `signature_requests`,
 * `document_requests`, `signature_signers`, `template_fill_links` — saindo três,
 * quatro e cinco vezes em poucos milissegundos. Não é polling: são consumidores
 * diferentes da mesma tela pedindo o mesmo dado ao mesmo tempo, mais o
 * StrictMode montando cada efeito duas vezes em desenvolvimento.
 *
 * A saída é a mais simples que resolve: quem chega enquanto uma consulta igual
 * ainda está no ar recebe a MESMA Promise em vez de abrir outra. Sem cache, sem
 * TTL, sem biblioteca nova — nada fica guardado depois que a resposta chega, e
 * por isso não há dado velho para invalidar. É só a rajada que desaparece.
 *
 * A chave precisa conter recurso + filtros + contexto (usuário, cliente, sala).
 * Uma chave frouxa faria consumidores diferentes receberem a resposta um do
 * outro — trocar dado entre clientes seria muito pior que a rajada.
 *
 * Sem imports de propósito: o módulo é puro para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do cliente Supabase.
 */

export interface CompartilhadorDeConsultas {
  /**
   * Executa `consulta` — ou devolve a que já está no ar para a mesma `chave`.
   * A entrada sai do mapa quando a Promise assenta, dando certo ou errado.
   */
  compartilhar: <T>(chave: string, consulta: () => Promise<T>) => Promise<T>;
  /** Quantas consultas estão no ar. Só para diagnóstico e teste. */
  emVoo: () => number;
}

export function criarCompartilhadorDeConsultas(opcoes: {
  /** Ex.: `[Jurius Fetch]`. */
  marca?: string;
  registrar?: (linha: string) => void;
} = {}): CompartilhadorDeConsultas {
  const marca = opcoes.marca ?? '[Jurius Fetch]';
  const registrar = opcoes.registrar;
  const emVoo = new Map<string, Promise<unknown>>();

  return {
    compartilhar: <T>(chave: string, consulta: () => Promise<T>): Promise<T> => {
      const existente = emVoo.get(chave);
      if (existente !== undefined) {
        registrar?.(`${marca}[${chave}] REUSE_IN_FLIGHT`);
        return existente as Promise<T>;
      }

      registrar?.(`${marca}[${chave}] START`);
      // A consulta pode estourar de forma SÍNCRONA (erro de montagem do filtro).
      // Sem este try, a chave ficaria presa no mapa para sempre e a tela nunca
      // mais buscaria esse recurso.
      let promessa: Promise<T>;
      try {
        promessa = consulta();
      } catch (erro) {
        return Promise.reject(erro);
      }

      // Sai do mapa dando certo OU errado: um erro preso aqui faria toda
      // tentativa seguinte receber a mesma falha, sem nunca ir à rede de novo.
      const acompanhada = promessa.finally(() => {
        if (emVoo.get(chave) === acompanhada) emVoo.delete(chave);
      });
      emVoo.set(chave, acompanhada);
      return acompanhada;
    },

    emVoo: () => emVoo.size,
  };
}

/**
 * Monta uma chave estável a partir de partes. Listas são ordenadas: o mesmo
 * conjunto de clientes pedido em ordens diferentes é a MESMA consulta, e sem
 * ordenar cada componente geraria a sua própria chave — de volta à rajada.
 */
export function chaveDeConsulta(
  recurso: string,
  partes: Record<string, string | number | boolean | null | undefined | readonly string[]> = {},
): string {
  const campos = Object.entries(partes)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? [...v].sort().join('.') : String(v)}`);
  return campos.length > 0 ? `${recurso}?${campos.join('&')}` : recurso;
}
