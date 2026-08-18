// A ligação dentro da thread — a bolha que o WhatsApp mostra para uma chamada.
//
// Ela é uma BOLHA, e não uma faixa central de sistema, porque uma chamada TEM
// lado: quem ligou para quem é metade da informação. Recebida encosta à
// esquerda, realizada à direita, exatamente como as mensagens em volta — assim
// a leitura de cima para baixo continua contando a história certa sem que
// ninguém precise ler o rótulo.
//
// O que ela carrega, nesta ordem: o desfecho (as palavras vêm de
// `threadCalls.ts`), a duração quando houve conversa, quem atendeu, a hora — e,
// quando o operador gravou, o áudio. O botão de ligar de volta fica só onde ele
// significa alguma coisa: numa chamada que ficou sem resposta.
import React from 'react';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { formatTime } from './format';
import { threadCallLabel, type ThreadCallDirection, type ThreadCallOutcome } from './threadCalls';
import { CallRecordingPlayer } from './callRecordingPlayer';

/** O que a thread precisa saber de uma chamada. Subconjunto de `CallLogRow`. */
export interface ThreadCall {
  id: string;
  direction: ThreadCallDirection;
  outcome: ThreadCallOutcome;
  startedAt: string;
  durationSeconds: number;
  /** Nome de quem falou, quando o perfil foi encontrado. */
  userName: string | null;
  recordingPath: string | null;
  /** Texto da gravação, quando alguém já pediu a transcrição. */
  transcript?: string | null;
}

const ICONS = { incoming: PhoneIncoming, outgoing: PhoneOutgoing, missed: PhoneMissed };

export const ThreadCallEntry: React.FC<{
  call: ThreadCall;
  privateMode?: boolean;
  /** Ligar de volta. Ausente = chamadas indisponíveis neste host. */
  onCallBack?: () => void;
}> = ({ call, privateMode, onCallBack }) => {
  const label = threadCallLabel(call);
  const Icon = ICONS[label.icon];
  // "Realizada" é nossa, logo desenha do lado de fora, como uma mensagem
  // enviada. Recebida vem da esquerda.
  const out = call.direction === 'outbound';
  // Ligar de volta só aparece onde resolve alguma coisa: numa chamada que
  // ninguém atendeu. Embaixo de uma conversa de seis minutos que acabou de
  // acontecer, o botão seria só ruído.
  const podeRetornar = !!onCallBack && call.outcome !== 'answered';

  return (
    <div className={`mb-1 flex px-1 ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-2.5 py-2 shadow-sm ring-1 ${
        label.attention
          ? 'bg-rose-50 ring-rose-200'
          : out ? 'bg-[#d9fdd3] ring-black/[0.04]' : 'bg-white ring-black/[0.05]'
      }`}>
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            label.attention ? 'bg-rose-100 text-rose-600' : 'bg-black/[0.06] text-slate-500'
          }`}>
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <p className={`text-[13px] font-semibold ${label.attention ? 'text-rose-700' : 'text-slate-700'}`}>
              {label.title}
            </p>
            <p className="text-[11.5px] text-slate-500 tabular-nums">
              {formatTime(call.startedAt)}
              {label.duration ? ` · ${label.duration}` : ''}
              {/* No modo privado o nome do atendente sai junto com o resto:
                  a tela está à vista de quem passa. */}
              {call.userName && !privateMode ? ` · ${call.userName}` : ''}
            </p>
          </div>
        </div>

        {call.recordingPath && !privateMode && <CallRecordingPlayer path={call.recordingPath} compact />}

        {call.transcript && !privateMode && (
          <div className="mt-1.5 max-w-[320px] rounded-lg bg-black/[0.04] p-2">
            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Transcrição
            </p>
            <p className="whitespace-pre-wrap text-[12px] leading-[1.45] text-slate-600">{call.transcript}</p>
          </div>
        )}

        {podeRetornar && (
          <button type="button" onClick={onCallBack}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11.5px] font-semibold text-white transition hover:bg-emerald-700">
            <PhoneOutgoing size={12} /> Ligar de volta
          </button>
        )}
      </div>
    </div>
  );
};

export default ThreadCallEntry;
