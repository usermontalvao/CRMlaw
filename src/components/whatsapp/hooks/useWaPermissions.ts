// A janela do React para o escopo de permissão do WhatsApp.
//
// A decisão mora em `services/whatsapp/waPermissions.ts` (puro, testado) e o
// dado vem de `services/whatsapp/scope.ts` (store externo, uma consulta para
// todas as telas). Este hook só costura os dois — e é de propósito que ele não
// tenha regra nenhuma dentro: regra que mora em componente não é testável e
// vira uma segunda verdade ao lado da do banco.
import { useMemo, useSyncExternalStore } from 'react';

import {
  assinarEscopoWa,
  escopoWaAtual,
} from '../../../services/whatsapp/scope';
import {
  ESCOPO_VAZIO,
  acoesPermitidas,
  estadoDoEscopo,
  modosDisponiveis,
  supervisionaAlgo,
  type EstadoDoEscopo,
  type WaAcoesPermitidas,
  type WaConversaResumo,
  type WaEscopo,
  type WaModoSupervisao,
} from '../../../services/whatsapp/waPermissions';

export function useWaEscopo(): WaEscopo {
  return useSyncExternalStore(assinarEscopoWa, escopoWaAtual, () => ESCOPO_VAZIO);
}

export interface PermissoesDaConversa {
  escopo: WaEscopo;
  acoes: WaAcoesPermitidas;
  modos: WaModoSupervisao[];
  /** Esta pessoa supervisiona alguma coisa? Decide se o seletor existe. */
  supervisor: boolean;
}

/**
 * O que dá para fazer nesta conversa, já apertado pelo modo de supervisão.
 *
 * `conversa` nulo (nenhuma selecionada) devolve tudo negado — é o que mantém a
 * barra de ações desabilitada em vez de piscar habilitada por um quadro.
 */
export function useWaPermissoes(
  conversa: WaConversaResumo | null,
  modo: WaModoSupervisao = 'acompanhar',
): PermissoesDaConversa {
  const escopo = useWaEscopo();
  return useMemo(() => {
    const alvo: WaConversaResumo = conversa ?? {
      id: '', instanceId: null, departmentId: null, assignedUserId: null, status: 'closed',
    };
    return {
      escopo,
      acoes: conversa
        ? acoesPermitidas(escopo, alvo, modo)
        : {
            ver: false, responder: false, assumir: false, transferir: false,
            redistribuir: false, aceitar: false, cancelarTransferencia: false,
            marcarLida: false, devolverFila: false, encerrar: false,
            reabrir: false, emprestar: false, controlarIa: false,
            supervisionando: false,
          },
      modos: conversa ? modosDisponiveis(escopo, alvo) : [],
      supervisor: supervisionaAlgo(escopo),
    };
  }, [escopo, conversa, modo]);
}

/** Carregando / sem canais / sem permissão / ok — três vazios diferentes. */
export function useEstadoDoEscopo(totalDeCanais: number | null): EstadoDoEscopo {
  const escopo = useWaEscopo();
  return useMemo(() => estadoDoEscopo(escopo, totalDeCanais), [escopo, totalDeCanais]);
}
