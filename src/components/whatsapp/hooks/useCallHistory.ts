// O histórico de ligações do escritório, carregado UMA vez para dois leitores.
//
// Dois lugares precisam da mesma lista, e por motivos diferentes:
//
//  · a ABA de ligações, que a desenha;
//  · o DISTINTIVO da aba, que só quer saber quantas perdidas ninguém retornou.
//
// O distintivo é a razão de o carregamento morar aqui e não dentro da lista. Um
// aviso que só aparece depois que a pessoa abre a aba não avisa nada: quem não
// desconfia que perdeu uma ligação nunca clica ali. Então a contagem tem de
// existir com a inbox aberta, antes de qualquer clique — e, existindo, a lista
// aproveita a mesma busca em vez de repeti-la.
//
// POR QUE NÃO REALTIME. Pelo mesmo motivo de `useConversationCalls`: a tabela
// `whatsapp_call_logs` não está na publicação, e pôr uma tabela lá tem custo
// real neste projeto (ver a memória sobre o WAL). O sinal que interessa já
// existe de graça dentro do navegador — o fim de uma chamada — e uma ligação
// feita da mesa do colega entra na próxima releitura.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { callLogService, type CallLogRow } from '../../../services/callLog.service';
import { waCallsStore } from '../../../services/wacalls/callStore';
import { unreturnedMissedIds } from '../callHistory';

/** Quanto esperar depois do fim da chamada para o registro já estar gravado. */
const RELOAD_DELAY_MS = 1200;
/**
 * Releitura de fundo. Existe por causa do colega da outra mesa: uma perdida que
 * tocou no navegador dele não gera evento nenhum aqui, e o distintivo ficaria
 * mentindo até alguém dar F5. Cinco minutos é o intervalo em que uma ligação
 * perdida ainda é notícia e a consulta não pesa.
 */
const BACKGROUND_MS = 5 * 60_000;

export interface CallHistory {
  calls: CallLogRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Ids das perdidas que ninguém retornou — ver `callHistory#unreturnedMissedIds`. */
  unreturned: Set<string>;
}

export function useCallHistory(enabled = true): CallHistory {
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(r => r + 1), []);

  useEffect(() => {
    if (!enabled) { setCalls([]); setLoading(false); return; }
    let vivo = true;
    setLoading(true);
    callLogService.listRecent()
      .then(list => { if (vivo) { setCalls(list); setError(null); } })
      .catch(e => { if (vivo) setError(e?.message || 'Não foi possível carregar as ligações.'); })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [enabled, revision]);

  // Uma chamada acabou nesta aba → o registro dela existe agora.
  const encerradas = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const solta = waCallsStore.subscribe(() => {
      const finais = waCallsStore.getSnapshot().calls
        .filter(c => c.phase === 'ENDED' || c.phase === 'FAILED').length;
      if (finais === encerradas.current) return;
      encerradas.current = finais;
      // Um só timer: duas chamadas encerradas em sequência pedem UMA releitura.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(reload, RELOAD_DELAY_MS);
    });
    const fundo = setInterval(reload, BACKGROUND_MS);
    return () => {
      solta();
      clearInterval(fundo);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, reload]);

  const unreturned = useMemo(() => unreturnedMissedIds(calls), [calls]);

  return { calls, loading, error, reload, unreturned };
}
