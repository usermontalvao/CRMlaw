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
//
// DUAS COISAS PRECISAM SER VISTAS SEM SER LIDAS, e é o que este arquivo
// desenha. Antes as chamadas saíam todas com a mesma cara e a thread virava uma
// fileira de bolhas iguais em que só o texto distinguia uma ligação de seis
// minutos gravada de uma tentativa que nem completou:
//
//  1. O DESFECHO TEM COR (`label.tone`, três valores — ver `threadCalls.ts`).
//     Vermelho é dívida (perdemos a ligação de alguém). VERDE é a nossa
//     tentativa sem resposta. Neutro é a conversa que aconteceu. A cor está no
//     disco do ícone, no título e no anel da bolha ao mesmo tempo: um só
//     acento, repetido, é o que se enxerga rolando a tela depressa.
//
//  2. A GRAVAÇÃO SE ANUNCIA. Ela é o único conteúdo que sobra de uma chamada, e
//     é a razão de alguém voltar naquela conversa semanas depois. Ganha
//     distintivo, moldura própria e um índigo que não colide com o vermelho nem
//     com o verde do desfecho — a ênfase é ORTOGONAL: uma perdida nunca é
//     gravada, mas "atendida" e "atendida COM áudio" são coisas diferentes e
//     precisavam parecer diferentes.
import React from 'react';
import { AudioLines, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { formatTime } from './format';
import {
  threadCallLabel,
  type ThreadCallDirection,
  type ThreadCallOutcome,
  type ThreadCallTone,
} from './threadCalls';
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

/**
 * As classes de cada desfecho, num lugar só.
 *
 * `bubble` é a cor de fundo da bolha quando ela NÃO é uma mensagem nossa
 * comum; `ring` é o anel; `chip` é o disco do ícone; `title` é o texto. Estar
 * tudo junto é o que impede o acento de sair pela metade — foi assim que a
 * distinção se perdeu da primeira vez.
 */
const TONES: Record<ThreadCallTone, { bubble: string; ring: string; chip: string; title: string }> = {
  perdida: {
    bubble: 'bg-rose-50',
    ring: 'ring-rose-200',
    chip: 'bg-rose-100 text-rose-600',
    title: 'text-rose-700',
  },
  'sem-resposta': {
    // O mesmo verde das mensagens enviadas, com o anel e o disco puxados para o
    // esmeralda: continua sendo "nossa" na leitura de lado, mas não se confunde
    // com a chamada que foi atendida.
    bubble: 'wa-call-bubble bg-[#d9fdd3]',
    ring: 'ring-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700',
    title: 'text-emerald-800',
  },
  atendida: {
    bubble: '',
    ring: '',
    chip: 'bg-black/[0.06] text-slate-500',
    title: 'text-slate-700',
  },
};

export const ThreadCallEntry: React.FC<{
  call: ThreadCall;
  privateMode?: boolean;
  /** Ligar de volta. Ausente = chamadas indisponíveis neste host. */
  onCallBack?: () => void;
}> = ({ call, privateMode, onCallBack }) => {
  const label = threadCallLabel(call);
  const Icon = ICONS[label.icon];
  const tone = TONES[label.tone];
  // "Realizada" é nossa, logo desenha do lado de fora, como uma mensagem
  // enviada. Recebida vem da esquerda.
  const out = call.direction === 'outbound';
  // Ligar de volta só aparece onde resolve alguma coisa: numa chamada que
  // ninguém atendeu. Embaixo de uma conversa de seis minutos que acabou de
  // acontecer, o botão seria só ruído.
  const podeRetornar = !!onCallBack && call.outcome !== 'answered';
  // A gravação só é ÊNFASE quando ela está à vista. No modo privado o áudio não
  // é oferecido, e um distintivo anunciando o que não se pode ouvir seria só
  // uma indiscrição a mais numa tela feita para não ter nenhuma.
  const temAudio = !!call.recordingPath && !privateMode;

  // O desfecho neutro cai na bolha padrão da conversa (verde do nosso lado,
  // branca do lado de lá); os outros dois trazem a própria cor.
  const fundo = tone.bubble || (out ? 'wa-call-bubble bg-[#d9fdd3]' : 'bg-white');
  const anel = tone.ring || (out ? 'ring-black/[0.04]' : 'ring-black/[0.05]');

  return (
    <div className={`mb-1 flex px-1 ${out ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-2.5 py-2 shadow-sm ring-1 ${fundo} ${anel} ${
        // A gravação puxa a bolha para fora do plano da conversa: sombra e um
        // segundo anel índigo do lado de fora. É o que faz o olho parar nela
        // quando a thread é rolada depressa.
        temAudio ? 'shadow-md ring-offset-1 ring-offset-indigo-200' : ''
      }`}>
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.chip}`}>
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${tone.title}`}>
              {label.title}
              {temAudio && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-600 px-1.5 py-[1px] text-[9.5px] font-bold uppercase tracking-wide text-white">
                  <AudioLines size={9} /> Gravada
                </span>
              )}
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

        {temAudio && (
          // Moldura própria: o áudio deixa de ser um controle solto embaixo do
          // texto e passa a ser o conteúdo da bolha, que é o que ele é.
          <div className="mt-1.5 rounded-lg bg-indigo-50/80 p-1.5 ring-1 ring-indigo-200">
            <CallRecordingPlayer path={call.recordingPath!} compact />
          </div>
        )}

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
            className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold text-white transition ${
              // O botão segue a cor do desfecho: numa perdida ele é a ação de
              // quitar a dívida (vermelho, como o resto da bolha); numa
              // tentativa sem resposta é só tentar de novo.
              label.tone === 'perdida'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}>
            <PhoneOutgoing size={12} /> Ligar de volta
          </button>
        )}
      </div>
    </div>
  );
};

export default ThreadCallEntry;
