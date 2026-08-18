// O histórico de ligações do escritório, carregado UMA vez para dois leitores.
//
// Dois lugares precisam da mesma lista, e por motivos diferentes:
//
//  · a ABA de ligações, que a desenha;
//  · o DISTINTIVO da aba, que só quer saber quantas perdidas ainda não foram
//    vistas.
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
import {
  markCallsSeen, readCallsSeenUntil, subscribeCallsSeen,
} from '../../../services/wacalls/callsSeen';
import { missedCallsForMe } from '../../../services/wacalls/routingData';
import { newestCallAt, unseenMissedCount } from '../callHistory';

/** Quanto esperar depois do fim da chamada para o registro já estar gravado. */
const RELOAD_DELAY_MS = 1200;
/**
 * Releitura de fundo. Existe por causa do colega da outra mesa: uma perdida que
 * tocou no navegador dele não gera evento nenhum aqui, e o distintivo ficaria
 * mentindo até alguém dar F5. Cinco minutos é o intervalo em que uma ligação
 * perdida ainda é notícia e a consulta não pesa.
 */
const BACKGROUND_MS = 5 * 60_000;

/**
 * A marca de "já vi as ligações até aqui" mora em `services/wacalls/callsSeen`.
 *
 * Ela não é mais só deste distintivo: o cartão de chamada perdida que fica na
 * tela em qualquer módulo (`missedCallStore`) lê e escreve a MESMA marca. Abrir
 * esta aba apaga aquele cartão, e dispensar aquele cartão zera este distintivo
 * — dois avisos discordando sobre a mesma ligação seria pior do que um só.
 */

export interface CallHistory {
  calls: CallLogRow[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** Perdidas que chegaram depois da última vez que alguém abriu a aba. */
  unseen: number;
  /**
   * "Eu vi." Chamada quando a aba de ligações é aberta — e enquanto ela fica
   * aberta, a cada releitura, como no celular: quem está olhando a lista não
   * precisa de aviso do que está na frente dele.
   */
  markSeen: () => void;
}

export function useCallHistory(enabled = true): CallHistory {
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  const [seenUntil, setSeenUntil] = useState<string | null>(readCallsSeenUntil);
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

  // Quem dispensou o cartão de chamada perdida (aqui ou noutra aba) já viu: o
  // distintivo acompanha sem esperar recarregamento.
  useEffect(() => subscribeCallsSeen(() => setSeenUntil(readCallsSeenUntil())), []);

  // O DISTINTIVO CONTA SÓ O QUE É MEU.
  //
  // A LISTA continua inteira — a aba de Ligações é o registro do escritório, e
  // esconder ligação de colega ali seria apagar histórico. O que é pessoal é o
  // AVISO: o número vermelho no alto da aba conta as perdidas que caíram na
  // minha parte da hierarquia, exatamente as mesmas que o cartão na tela
  // mostra (ver `missedCallsForMe`). Sem isto, o distintivo acenderia por uma
  // ligação que nenhum cartão meu mostra — e dispensar o cartão não o apagaria.
  const [minhas, setMinhas] = useState<Set<string> | null>(null);
  useEffect(() => {
    let vivo = true;
    const perdidas = calls.filter(c => c.direction === 'inbound' && c.outcome === 'missed');
    if (perdidas.length === 0) { setMinhas(new Set()); return; }
    void missedCallsForMe(perdidas).then(lista => {
      if (vivo) setMinhas(new Set(lista.map(c => c.callId)));
    });
    return () => { vivo = false; };
  }, [calls]);

  const unseen = useMemo(
    // `minhas` nulo é "ainda não sei de quem são": conta tudo, como antes. Um
    // distintivo a mais por dois segundos é melhor que um aviso que sumiu.
    () => unseenMissedCount(minhas ? calls.filter(c => minhas.has(c.callId)) : calls, seenUntil),
    [calls, seenUntil, minhas],
  );

  const markSeen = useCallback(() => {
    // A marca é o horário da chamada MAIS RECENTE da lista, não `Date.now()`:
    // uma chamada que chegou ao servidor enquanto a consulta voltava nasceria
    // com horário anterior ao relógio e nunca mais seria contada.
    const marca = newestCallAt(calls);
    if (!marca || marca === seenUntil) return;
    if (markCallsSeen(marca)) setSeenUntil(marca);
  }, [calls, seenUntil]);

  return { calls, loading, error, reload, unseen, markSeen };
}
