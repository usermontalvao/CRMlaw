/**
 * A janela de recarga do e-mail e das petições.
 *
 * Os dois módulos usam o broadcast como campainha: o handler descarta o payload
 * e recarrega a lista por HTTP. Sem uma janela, um lote — a sincronização de
 * e-mail insere em bloco, o editor salva sozinho de tempos em tempos — viraria
 * uma recarga por aviso. Com ela, cada rajada vira uma recarga só.
 *
 * O gatilho no banco já dispara por COMANDO (e não por linha), então este
 * agrupamento é a segunda rede contra rajada, não a primeira.
 *
 * Nada do conteúdo passa por aqui: o handler não recebe argumento, e o log
 * registra só que uma recarga foi agendada.
 *
 * Sem imports: o módulo é puro de propósito, para o ts-node do `npm test`
 * conseguir carregá-lo sem arrastar a cadeia de imports do cliente Supabase.
 */

export interface OpcoesRecargaAgrupada {
  /** Aparece no log: `Email`, `Petitions`. */
  escopo: string;
  /** Janela do agrupamento, em ms. */
  atrasoMs: number;
  /** O que fazer quando a janela fecha. */
  recarregar: () => void;
  registrar?: (linha: string) => void;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
}

export interface RecargaAgrupada {
  /** Um aviso do broadcast. Abre a janela, ou reinicia a que estiver aberta. */
  aoEvento: () => void;
  /** Desmontagem: cancela a janela pendente. Depois disto, `aoEvento` não faz nada. */
  encerrar: () => void;
}

export function criarRecargaAgrupada(opcoes: OpcoesRecargaAgrupada): RecargaAgrupada {
  const registrar = opcoes.registrar ?? ((linha: string) => console.info(linha));
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar =
    opcoes.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));

  const marca = `[Jurius Realtime][${opcoes.escopo}]`;

  let timer: unknown = null;
  let encerrado = false;

  return {
    aoEvento: () => {
      // Depois do cleanup não se agenda mais nada: a recarga chamaria um
      // componente já desmontado. Um evento em voo entre o `unsubscribe` e o
      // fechamento do socket cai exatamente aqui.
      if (encerrado) return;
      registrar(`${marca} RELOAD_SCHEDULED`);
      if (timer !== null) cancelar(timer);
      timer = agendar(() => {
        timer = null;
        opcoes.recarregar();
      }, opcoes.atrasoMs);
    },

    encerrar: () => {
      encerrado = true;
      if (timer === null) return;
      cancelar(timer);
      timer = null;
    },
  };
}
