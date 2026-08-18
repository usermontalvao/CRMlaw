// DEV-ONLY: bancada das chamadas de voz (?wacallspreview=1).
//
// Serve para duas coisas que a inbox real não permite conferir sem uma linha
// tocando: (1) a aparência de cada estado da chamada, e (2) se o WaCalls
// responde a ESTA origem — a listagem de sessões e o SSE são feitos de verdade
// contra o servidor configurado, e o resultado aparece na tela.
import React, { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { ActiveCallWidget, IncomingCallCard } from '../components/whatsapp/callModals';
import { playCallConnectedTone, playCallEndedTone, startRing, stopRing } from '../services/wacalls/ringtone';
import { waCallsService } from '../services/wacalls.service';
import { WACALLS_BASE_URL } from '../services/wacalls/config';
import type { WaCall, WaCallPhase, WaCallsSession } from '../services/wacalls/types';

const chamada = (patch: Partial<WaCall>): WaCall => ({
  callId: 'call-demo',
  sessionId: 'sessao-demo',
  direction: 'outbound',
  phase: 'CALLING',
  phone: '5565984046375',
  lid: null,
  contact: { conversationId: 'c1', clientId: null, name: 'Isabel Maria', avatarUrl: null },
  mine: true,
  startedAt: Date.now(),
  connectedAt: null,
  endedAt: null,
  endReason: null,
  muted: false,
  route: { ring: true, show: true, label: 'Sem responsável definido — tocando para todos' },
  recording: false,
  recorded: false,
  error: null,
  ...patch,
});

const FASES: WaCallPhase[] = ['PREPARING', 'CALLING', 'RINGING', 'ACTIVE', 'ENDING', 'ENDED', 'FAILED'];

const WaCallsPreview: React.FC = () => {
  const [fase, setFase] = useState<WaCallPhase>('CALLING');
  const [mudo, setMudo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [semRede, setSemRede] = useState(false);
  // As três leituras possíveis do convite: minha, de outro atendente (calada) e
  // escalada. É a regra do `callRouting` vista pelos olhos de quem está na mesa.
  const [rota, setRota] = useState<0 | 1 | 2>(0);
  const rotaDoConvite = [
    { ring: true, show: true, label: 'Sem responsável definido — tocando para todos' },
    { ring: false, show: true, label: 'Tocando para Bruno (responsável pela conversa)' },
    { ring: true, show: true, label: 'Bruno não atendeu: a chamada foi liberada para todos' },
  ][rota];
  const [recebida, setRecebida] = useState(true);
  // Convite que chegou endereçado só por LID: o WhatsApp não mandou telefone
  // nenhum, e o cartão precisa DIZER isso em vez de inventar um número. Foi o
  // defeito de 17/08/2026 (ver `services/wacalls/phone.ts`).
  const [semNumero, setSemNumero] = useState(false);
  const [sessoes, setSessoes] = useState<WaCallsSession[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sse, setSse] = useState('conectando…');
  const [eventos, setEventos] = useState<string[]>([]);

  useEffect(() => {
    waCallsService.getSessions().then(setSessoes).catch(e => setErro(String(e?.message || e)));
    return waCallsService.connectEvents({
      onOpen: () => setSse('conectado'),
      onError: () => setSse('sem conexão (o EventSource retenta sozinho)'),
      onEvent: ev => setEventos(prev => [`${new Date().toLocaleTimeString('pt-BR')} · ${ev.type}`, ...prev].slice(0, 12)),
    });
  }, []);

  const ativa = chamada({
    phase: fase,
    muted: mudo,
    recording: gravando,
    recorded: gravando,
    connectedAt: fase === 'ACTIVE' || fase === 'ENDING' || fase === 'ENDED' ? Date.now() - 63_000 : null,
    error: fase === 'FAILED' ? 'Não foi possível abrir o áudio da chamada.' : null,
  });

  return (
    <div className="min-h-screen bg-[#faf9f7] p-8 text-slate-800">
      <h1 className="flex items-center gap-2 text-[18px] font-bold"><PhoneCall size={18} /> Chamadas de voz (WaCalls)</h1>

      <section className="mt-5 max-w-2xl rounded-xl border border-[#e7e5df] bg-white p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-slate-400">Serviço</p>
        <p className="mt-1 text-[13px]">{WACALLS_BASE_URL}</p>
        <p className="mt-2 text-[13px]">
          Sessões: {erro ? <span className="text-red-600">{erro}</span>
            : sessoes === null ? 'consultando…'
            : sessoes.length === 0 ? <span className="text-amber-600">nenhuma conta cadastrada no WaCalls</span>
            : sessoes.map(s => `${s.name} (${s.state}${s.paired ? ', pareada' : ''})`).join(' · ')}
        </p>
        <p className="mt-1 text-[13px]">SSE: {sse}</p>
        <ul className="mt-2 space-y-0.5 text-[12px] text-slate-500">
          {eventos.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      </section>

      <div className="relative mt-5 flex max-w-md flex-wrap gap-2">
        {FASES.map(f => (
          <button key={f} onClick={() => setFase(f)}
            className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${f === fase ? 'bg-amber-600 text-white' : 'bg-white text-slate-600 border border-[#e7e5df]'}`}>
            {f}
          </button>
        ))}
        <button onClick={() => setRecebida(v => !v)}
          className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">
          {recebida ? 'esconder' : 'mostrar'} chamada recebida
        </button>
        <button onClick={() => setRota(r => ((r + 1) % 3) as 0 | 1 | 2)}
          className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">
          rota do convite ({rota + 1}/3)
        </button>
        <button onClick={() => setSemRede(v => !v)}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${semRede ? 'bg-amber-500 text-white' : 'border border-[#e7e5df] bg-white text-slate-600'}`}>
          sem internet
        </button>
        <button onClick={() => setSemNumero(v => !v)}
          title="O convite chegou endereçado por LID: o WhatsApp não mandou telefone nenhum"
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${semNumero ? 'bg-amber-500 text-white' : 'border border-[#e7e5df] bg-white text-slate-600'}`}>
          convite só com LID
        </button>
      </div>

      {/* Toques: o painel não os dispara sozinho (quem faz isso é o WaCallsHost,
          a partir da fase da chamada), então a bancada os aciona na mão. */}
      <div className="mt-3 flex max-w-md flex-wrap gap-2">
        <button onClick={() => startRing('incoming')} className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">tocar (recebida)</button>
        <button onClick={() => startRing('outgoing')} className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">tocar (chamando)</button>
        <button onClick={stopRing} className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">parar</button>
        <button onClick={playCallConnectedTone} className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">atendeu</button>
        <button onClick={playCallEndedTone} className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">desligou</button>
      </div>

      <ActiveCallWidget
        call={ativa}
        linkDown={semRede}
        onHangUp={() => setFase('ENDED')}
        onToggleMute={() => setMudo(v => !v)}
        onToggleRecording={() => setGravando(v => !v)}
        onOpenConversation={() => window.alert('abriria a conversa do contato')}
      />
      {recebida && (
        <IncomingCallCard
          call={chamada({
            callId: 'call-in', direction: 'inbound', phase: 'RINGING', mine: false, contact: null,
            phone: semNumero ? '' : '5565992216459',
            lid: semNumero ? '252677908865131' : null,
            route: rotaDoConvite,
          })}
          onAccept={() => setRecebida(false)}
          onReject={() => setRecebida(false)}
        />
      )}
    </div>
  );
};

export default WaCallsPreview;
