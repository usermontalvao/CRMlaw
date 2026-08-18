// A aba de LIGAÇÕES da inbox — o histórico que o escritório não tinha.
//
// A pergunta que ela responde é a que nenhuma outra tela respondia: "quem
// ligou?". A ficha do cliente só conhece as ligações daquele cliente; a thread,
// as daquela conversa. Uma chamada perdida de alguém que ninguém abriu depois
// não aparecia em lugar nenhum do CRM — o escritório descobria pelo celular, se
// descobrisse.
//
// TRÊS COISAS ORIENTAM O DESENHO:
//
//  1. É HISTÓRICO, NÃO LISTA DE TAREFAS. Tudo em ordem de tempo, agrupado por
//     dia, e a chamada perdida em vermelho — como no celular. Ela fica vermelha
//     para sempre: é o registro de um fato, não uma pendência que alguém dá
//     baixa. A primeira versão desta tela marcava "em aberto" as perdidas que
//     ninguém tinha ligado de volta, e isso mentia (a recepção retorna por
//     MENSAGEM na maioria das vezes) e nunca zerava. Ver `callHistory.ts`.
//  2. AS DUAS AÇÕES ESTÃO NA LINHA. Ligar de novo e abrir a conversa são o que
//     alguém quer fazer olhando para uma ligação; escondê-las atrás de um menu
//     transformaria a tela num relatório.
//  3. O QUE NÃO SE SABE, NÃO SE INVENTA. Chamada endereçada por LID não tem
//     telefone (ver `callHistory.ts`): ela aparece, diz que o número não foi
//     identificado, e o botão de discar não vem junto.
import React, { useEffect, useMemo, useState } from 'react';
import { AudioLines, Loader2, MessageSquare, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, RefreshCw } from 'lucide-react';
import { type CallLogRow } from '../../services/callLog.service';
import { resolveAvatarUrl } from '../../services/whatsapp/shared';
import { callHistoryIdentity, formatCallPhone } from './callHistory';
import { threadCallLabel, type ThreadCallTone } from './threadCalls';
import { dayLabel, initials } from './format';

const ICONS = { incoming: PhoneIncoming, outgoing: PhoneOutgoing, missed: PhoneMissed };

/**
 * A hora da ligação — sempre o relógio, nunca a data.
 *
 * O `formatTime` da inbox troca a hora pela data fora do dia de hoje, e ali ele
 * está certo: a lista de conversas não tem cabeçalho de dia. Aqui tem. Repetir
 * "17/08/26" em cada linha embaixo de um cabeçalho que já diz "Ontem" custa a
 * única informação que a coluna deveria dar — a que horas o telefone tocou.
 */
const callClock = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

/** As mesmas três cores da bolha da conversa (ver `threadCallEntry.tsx`). */
const TONES: Record<ThreadCallTone, { chip: string; title: string; row: string }> = {
  perdida: { chip: 'bg-rose-100 text-rose-600', title: 'text-rose-700', row: 'hover:bg-rose-50/60' },
  'sem-resposta': { chip: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-800', row: 'hover:bg-emerald-50/60' },
  atendida: { chip: 'bg-black/[0.06] text-slate-500', title: 'text-slate-600', row: 'hover:bg-[#f3f2ef]' },
};

/**
 * O rosto do contato. Assinado sob demanda, um por linha.
 *
 * A assinatura do bucket custa uma ida ao servidor, mas aqui ela vale: a lista
 * tem dezenas de linhas, não centenas, e um histórico de ligações sem rosto
 * obriga a ler o nome de cada uma para achar a pessoa certa.
 */
const CallAvatar: React.FC<{ path: string | null | undefined; name: string; phone: string }> = ({ path, name, phone }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) { setUrl(null); return; }
    let vivo = true;
    resolveAvatarUrl(path).then(u => { if (vivo) setUrl(u); }).catch(() => { /* sem rosto, iniciais */ });
    return () => { vivo = false; };
  }, [path]);

  if (url) {
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e7e5df] text-[12.5px] font-bold text-slate-500">
      {initials(name, phone)}
    </span>
  );
};

export const CallHistoryList: React.FC<{
  /**
   * O histórico já carregado. Vem de fora (`useCallHistory`) porque o
   * distintivo da aba precisa da mesma lista ANTES de alguém abrir esta tela —
   * um aviso de chamada perdida que só aparece depois do clique não avisa nada.
   */
  calls: CallLogRow[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  /** Modo privado: sem nome, sem número, sem rosto. */
  privateMode?: boolean;
  /** Abrir a conversa daquela ligação. Ausente quando não há conversa. */
  onOpenConversation?: (conversationId: string) => void;
  /** Ligar de novo. Ausente = chamadas indisponíveis neste host. */
  onCall?: (phone: string, name: string | null, conversationId: string | null) => void;
}> = ({ calls, loading, error: erro, onReload, privateMode, onOpenConversation, onCall }) => {
  // Agrupado por dia, como qualquer histórico de ligações — "hoje" e "ontem"
  // localizam a chamada melhor do que a data cheia.
  const porDia = useMemo(() => {
    const grupos: Array<{ dia: string; itens: CallLogRow[] }> = [];
    for (const c of calls) {
      const dia = dayLabel(c.startedAt);
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.itens.push(c);
      else grupos.push({ dia, itens: [c] });
    }
    return grupos;
  }, [calls]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando as ligações…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[13px] text-slate-500">{erro}</p>
        <button onClick={onReload}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#f3f2ef] px-3 py-1.5 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-200">
          <RefreshCw size={12} /> Tentar de novo
        </button>
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="px-4 py-14 text-center">
        <Phone className="mx-auto h-7 w-7 text-slate-300" />
        <p className="mt-2 text-[13px] font-semibold text-slate-500">Nenhuma ligação ainda</p>
        <p className="mt-0.5 text-[12px] text-slate-400">
          As chamadas de voz do WhatsApp aparecem aqui assim que a primeira acontecer.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-3">
      {/* Sem faixa de resumo: a tela é o histórico, e um contador no alto dela
          reintroduziria a ideia de fila que este arquivo acabou de tirar. */}
      <div className="flex items-center justify-end px-3 pt-2 pb-0.5">
        <button onClick={onReload} title="Atualizar"
          className="rounded-lg p-1 text-slate-400 transition hover:bg-[#f3f2ef] hover:text-slate-600">
          <RefreshCw size={13} />
        </button>
      </div>

      {porDia.map(grupo => (
        <div key={grupo.dia}>
          <p className="sticky top-0 z-[1] bg-white/95 px-3 py-1 text-[11px] font-semibold text-slate-400 backdrop-blur">
            {grupo.dia}
          </p>
          {grupo.itens.map(call => {
            const label = threadCallLabel(call);
            const tone = TONES[label.tone];
            const Icon = ICONS[label.icon];
            const identidade = callHistoryIdentity({
              id: call.id,
              direction: call.direction,
              outcome: call.outcome,
              phone: call.phone,
              peerLid: call.peerLid,
              contactName: call.contactName,
              startedAt: call.startedAt,
              conversationId: call.conversationId,
            });
            const nome = privateMode ? 'Contato' : identidade.title;
            const podeLigar = !!onCall && identidade.callable && !privateMode;
            const podeAbrir = !!onOpenConversation && !!call.conversationId;

            return (
              <div key={call.id}
                onClick={podeAbrir ? () => onOpenConversation!(call.conversationId!) : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 transition ${tone.row} ${
                  podeAbrir ? 'cursor-pointer' : ''
                }`}>
                {privateMode
                  ? <span className="h-10 w-10 shrink-0 rounded-full bg-[#e7e5df]" />
                  : <CallAvatar path={call.contactAvatarPath} name={identidade.unknown ? '' : identidade.title} phone={call.phone} />}

                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13.5px] font-semibold ${
                    identidade.unknown && !privateMode ? 'italic text-slate-400' : 'text-slate-800'
                  }`}>
                    {nome}
                  </p>
                  {/* Envolve em vez de cortar: os distintivos ("Gravada", "Em
                      aberto") são a informação que faz alguém parar nesta linha,
                      e `truncate` comia justamente eles — sobrava metade da
                      palavra e um pontinho colorido sem sentido. */}
                  <p className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[12px] font-medium ${tone.title}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
                      <Icon size={9} />
                    </span>
                    <span className="truncate">
                      {label.title}
                      {label.duration ? ` · ${label.duration}` : ''}
                    </span>
                    {call.recordingPath && !privateMode && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-indigo-600 px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide text-white">
                        <AudioLines size={8} /> Gravada
                      </span>
                    )}
                  </p>
                  {/* O número embaixo do nome só quando o nome não É o número. */}
                  {!privateMode && !identidade.unknown && call.contactName && call.phone && (
                    <p className="truncate text-[11px] text-slate-400 tabular-nums">{formatCallPhone(call.phone)}</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <span className="mr-0.5 text-[11.5px] text-slate-400 tabular-nums">{callClock(call.startedAt)}</span>
                  {podeAbrir && (
                    <button type="button" title="Abrir a conversa"
                      onClick={(e) => { e.stopPropagation(); onOpenConversation!(call.conversationId!); }}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-black/[0.06] hover:text-slate-600">
                      <MessageSquare size={15} />
                    </button>
                  )}
                  {podeLigar && (
                    <button type="button" title={`Ligar para ${identidade.title}`}
                      onClick={(e) => { e.stopPropagation(); onCall!(call.phone, call.contactName ?? null, call.conversationId ?? null); }}
                      /* Verde sempre, como o botão de ligar do WhatsApp: ele é
                         a ação de ligar, não o alarme de uma pendência. */
                      className="rounded-lg bg-emerald-600 p-1.5 text-white transition hover:bg-emerald-700">
                      <Phone size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export default CallHistoryList;
