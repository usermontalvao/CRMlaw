// As chamadas que a thread da conversa desenha.
//
// Busca as ligações daquele contato e as mantém FRESCAS sem realtime: a linha
// da chamada só existe depois que ela acaba (é o fim dela que sabe a duração e
// o desfecho — ver `wacalls/callStore#archiveCall`), e quem faz a ligação é
// esta mesma aba. Então a hora de reler é a hora em que uma chamada morre.
//
// POR QUE NÃO REALTIME. A tabela `whatsapp_call_logs` não está na publicação, e
// pôr uma tabela lá tem custo real neste projeto (ver a memória sobre o WAL). O
// sinal que interessa já existe de graça dentro do navegador: o store das
// chamadas. Um colega que ligar da mesa dele não aparece aqui na hora — aparece
// ao reabrir a conversa, que é quando alguém de fato vai ler aquilo.
//
// O atraso de 1,2 s existe porque `logCall` roda DEPOIS do encerramento na
// tela: reler no mesmo instante em que o cartão some traria a lista sem a
// chamada que acabou de acontecer.
import { useEffect, useMemo, useRef, useState } from 'react';
import { callLogService, type CallLogRow } from '../../../services/callLog.service';
import { waCallsStore } from '../../../services/wacalls/callStore';

/** Quanto esperar depois do fim da chamada para o registro já estar gravado. */
const RELOAD_DELAY_MS = 1200;

export function useConversationCalls(
  conversationId: string | null,
  phones: Array<string | null | undefined>,
): CallLogRow[] {
  const [calls, setCalls] = useState<CallLogRow[]>([]);
  // `phones` vem de props e troca de identidade a cada render do pai; sem uma
  // chave estável o efeito recarregaria em looping.
  const phoneKey = phones.filter(Boolean).join('|');
  // Sobe a cada chamada encerrada — é o gatilho de releitura.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!conversationId) { setCalls([]); return; }
    let vivo = true;
    callLogService
      .listByConversation(conversationId, phoneKey ? phoneKey.split('|') : [])
      .then(list => { if (vivo) setCalls(list); })
      // Falhar aqui não pode esvaziar a thread: sem as chamadas, as mensagens
      // continuam sendo a conversa.
      .catch(() => { if (vivo) setCalls([]); });
    return () => { vivo = false; };
  }, [conversationId, phoneKey, revision]);

  // Uma chamada acabou nesta aba → o registro dela existe agora.
  const encerradas = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const solta = waCallsStore.subscribe(() => {
      const finais = waCallsStore.getSnapshot().calls
        .filter(c => c.phase === 'ENDED' || c.phase === 'FAILED').length;
      if (finais === encerradas.current) return;
      encerradas.current = finais;
      // Um só timer: duas chamadas encerradas em sequência (o cartão do
      // servidor e o encerramento local) pedem UMA releitura, não duas.
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setRevision(r => r + 1), RELOAD_DELAY_MS);
    });
    return () => {
      solta();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return useMemo(() => calls, [calls]);
}
