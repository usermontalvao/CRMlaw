// DEV-ONLY: bancada das chamadas de voz (?wacallspreview=1).
//
// Serve para duas coisas que a inbox real não permite conferir sem uma linha
// tocando: (1) a aparência de cada estado da chamada, e (2) se o WaCalls
// responde a ESTA origem — a listagem de sessões e o SSE são feitos de verdade
// contra o servidor configurado, e o resultado aparece na tela.
import React, { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { ActiveCallModal, IncomingCallCard } from '../components/whatsapp/callModals';
import { waCallsService } from '../services/wacalls.service';
import { WACALLS_BASE_URL } from '../services/wacalls/config';
import type { WaCall, WaCallPhase, WaCallsSession } from '../services/wacalls/types';

const chamada = (patch: Partial<WaCall>): WaCall => ({
  callId: 'call-demo',
  sessionId: 'sessao-demo',
  direction: 'outbound',
  phase: 'CALLING',
  phone: '5565984046375',
  contact: { conversationId: 'c1', clientId: null, name: 'Isabel Maria', avatarUrl: null },
  mine: true,
  startedAt: Date.now(),
  connectedAt: null,
  endedAt: null,
  endReason: null,
  muted: false,
  error: null,
  ...patch,
});

const FASES: WaCallPhase[] = ['PREPARING', 'CALLING', 'RINGING', 'ACTIVE', 'ENDING', 'ENDED', 'FAILED'];

const WaCallsPreview: React.FC = () => {
  const [fase, setFase] = useState<WaCallPhase>('CALLING');
  const [mudo, setMudo] = useState(false);
  const [recebida, setRecebida] = useState(true);
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

      {/* Acima do scrim do modal: senão os controles da bancada ficam atrás dele. */}
      <div className="relative z-[96] mt-5 flex max-w-md flex-wrap gap-2">
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
      </div>

      <ActiveCallModal call={ativa} onHangUp={() => setFase('ENDED')} onToggleMute={() => setMudo(v => !v)} />
      {recebida && (
        <IncomingCallCard
          call={chamada({ callId: 'call-in', direction: 'inbound', phase: 'RINGING', mine: false, contact: null, phone: '5565992216459' })}
          onAccept={() => setRecebida(false)}
          onReject={() => setRecebida(false)}
        />
      )}
    </div>
  );
};

export default WaCallsPreview;
