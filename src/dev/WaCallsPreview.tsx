// DEV-ONLY: bancada das chamadas de voz (?wacallspreview=1).
//
// Serve para duas coisas que a inbox real não permite conferir sem uma linha
// tocando: (1) a aparência de cada estado da chamada, e (2) se o serviço de
// chamadas responde a ESTA origem — o status e o WebSocket são feitos de
// verdade contra o servidor configurado, e o resultado aparece na tela.
import React, { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import { ActiveCallWidget, IncomingCallCard } from '../components/whatsapp/callModals';
import { CallVideoScreen } from '../components/whatsapp/callVideoScreen';
import { MissedCallWidget } from '../components/whatsapp/MissedCallWidget';
import type { MissedCall } from '../services/wacalls/missedCalls';
import { playCallConnectedTone, playCallEndedTone, startRing, stopRing } from '../services/wacalls/ringtone';
import { waCallsService } from '../services/wacalls.service';
import { WACALLS_BASE_URL } from '../services/wacalls/config';
import { buildCallLadder, decideCallRing } from '../services/wacalls/callRouting';
import type { WaCall, WaCallPhase, WaCallsSession } from '../services/wacalls/types';
import type { CallGuest } from '../services/wacalls/callBridge';
import type { InvitableOperator } from '../services/wacalls/callGuests';

/** O escritório de mentira da bancada. */
const EQUIPE_DEMO: InvitableOperator[] = [
  { userId: 'ana', name: 'Ana Beatriz', busy: false },
  { userId: 'bruno', name: 'Bruno Alves', busy: true },
  { userId: 'carla', name: 'Carla Menezes', busy: false },
];

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
  route: { ring: true, show: true, source: 'assigned', targetUserIds: [], hasNextStep: false, label: 'Sem responsável definido — tocando para todos' },
  videoOn: false,
  peerVideo: false,
  wasVideo: false,
  recording: false,
  recorded: false,
  error: null,
  ...patch,
});

const FASES: WaCallPhase[] = ['PREPARING', 'CALLING', 'RINGING', 'ACTIVE', 'ENDING', 'ENDED', 'FAILED'];

/**
 * As perdidas da bancada: as três formas que uma chamada perdida tem de
 * aparecer — quem tem cadastro, quem só tem número, e quem ligou anônimo (só
 * LID). A do meio insistiu duas vezes, para conferir o agrupamento.
 */
const PERDIDAS: MissedCall[] = [
  {
    callId: 'm1', phone: '5565996128787', lid: null, name: 'Lisliandra Cerqueira',
    avatarUrl: null, avatarPath: null, conversationId: 'c1', clientId: 'cli-1',
    startedAt: Date.now() - 4 * 60_000,
  },
  {
    callId: 'm2', phone: '5565992216459', lid: null, name: null,
    avatarUrl: null, avatarPath: null, conversationId: null, clientId: null,
    startedAt: Date.now() - 26 * 60_000,
  },
  {
    callId: 'm3', phone: '5565992216459', lid: null, name: null,
    avatarUrl: null, avatarPath: null, conversationId: null, clientId: null,
    startedAt: Date.now() - 39 * 60_000,
  },
  {
    callId: 'm4', phone: '', lid: '252677908865131', name: null,
    avatarUrl: null, avatarPath: null, conversationId: null, clientId: null,
    startedAt: Date.now() - 3 * 60 * 60_000,
  },
];

/**
 * Imagem de mentira, desenhada num canvas.
 *
 * A bancada roda sem câmera e sem ligação, e mesmo assim precisa mostrar a tela
 * cheia como ela fica de verdade: o outro lado EM PÉ (é o celular do cliente,
 * a origem das duas tarjas pretas e do fundo borrado) e a nossa câmera DEITADA,
 * com uma seta para cima — é a seta que denuncia se o giro está certo.
 */
function usarImagemDeMentira(ligada: boolean): () => { local: MediaStream | null; remote: MediaStream | null } | null {
  const refs = React.useRef<{ local: MediaStream; remote: MediaStream } | null>(null);
  const [, forcar] = useState(0);

  useEffect(() => {
    if (!ligada) return;
    const pintar = (
      largura: number,
      altura: number,
      titulo: string,
      cor: string,
      seta: boolean,
    ) => {
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(10);
      let t = 0;
      const timer = window.setInterval(() => {
        t += 1;
        ctx.fillStyle = cor;
        ctx.fillRect(0, 0, largura, altura);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(titulo, largura / 2, altura / 2 - 10);
        ctx.font = '20px sans-serif';
        ctx.fillText(`${largura}x${altura} · ${t}`, largura / 2, altura / 2 + 26);
        if (seta) {
          // Seta para o topo do quadro: girada, ela aponta para o lado — que é
          // exatamente o defeito que o botão "Girar" conserta.
          ctx.beginPath();
          ctx.moveTo(largura / 2, 24);
          ctx.lineTo(largura / 2 - 26, 78);
          ctx.lineTo(largura / 2 + 26, 78);
          ctx.closePath();
          ctx.fill();
        }
      }, 100);
      return { stream, timer };
    };
    const remoto = pintar(480, 640, 'CONTATO', '#123f34', false);
    const local = pintar(640, 480, 'VOCÊ', '#3f2a12', true);
    refs.current = { local: local.stream, remote: remoto.stream };
    forcar(n => n + 1);
    return () => {
      window.clearInterval(remoto.timer);
      window.clearInterval(local.timer);
      remoto.stream.getTracks().forEach(t => t.stop());
      local.stream.getTracks().forEach(t => t.stop());
      refs.current = null;
    };
  }, [ligada]);

  return () => (ligada && refs.current ? refs.current : null);
}

const WaCallsPreview: React.FC = () => {
  const [fase, setFase] = useState<WaCallPhase>('CALLING');
  const [mudo, setMudo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [semRede, setSemRede] = useState(false);
  // As três leituras possíveis do convite: minha, de outro atendente (calada) e
  // escalada. É a regra do `callRouting` vista pelos olhos de quem está na mesa.
  const [rota, setRota] = useState<0 | 1 | 2>(0);
  // A bancada roda a REGRA de verdade, não rótulos escritos à mão: o escritório
  // de exemplo tem Bruno como responsável da conversa, a Recepção ligada ao
  // canal e a administração no fim da escada; o botão só anda com a escalada.
  const escadaDoExemplo = buildCallLadder({
    assignedUserId: 'bruno', assignedName: 'Bruno',
    channelDepartments: [{ name: 'Recepção', memberIds: ['davi', 'eu'] }],
    adminIds: ['chefe'],
  });
  const rotaDoConvite = decideCallRing({
    me: rota === 0 ? 'bruno' : 'eu',
    ladder: escadaDoExemplo,
    step: rota,
    contactBlocked: false,
    imBusy: false,
  });
  // A bancada do segundo atendente: convidar move o cartão pelos estados sem
  // rede nenhuma envolvida (a ponte de verdade precisa de duas abas logadas).
  const [convidados, setConvidados] = useState<CallGuest[]>([]);
  useEffect(() => {
    if (convidados.length === 0 || convidados[0].status !== 'inviting') return;
    const t = setTimeout(() => setConvidados(atual => atual.map(g => ({ ...g, status: 'live' }))), 1200);
    return () => clearTimeout(t);
  }, [convidados]);
  // A chamada de VÍDEO: as duas câmeras, o giro da nossa imagem e a escolha
  // entre a tela cheia e o painel flutuante.
  const [videoNos, setVideoNos] = useState(false);
  const [videoDele, setVideoDele] = useState(false);
  const [giro, setGiro] = useState(0);
  const [telaCheia, setTelaCheia] = useState(true);
  const streamsDeMentira = usarImagemDeMentira(videoNos || videoDele);
  const [recebida, setRecebida] = useState(true);
  // Convite que chegou endereçado só por LID: o WhatsApp não mandou telefone
  // nenhum, e o cartão precisa DIZER isso em vez de inventar um número. Foi o
  // defeito de 17/08/2026 (ver `services/wacalls/phone.ts`).
  const [semNumero, setSemNumero] = useState(false);
  const [perdidas, setPerdidas] = useState<MissedCall[]>(PERDIDAS);
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
    videoOn: videoNos,
    peerVideo: videoDele,
    wasVideo: videoNos || videoDele,
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
        <button onClick={() => setPerdidas(PERDIDAS)}
          title="Devolve o cartão de chamadas perdidas ao estado inicial"
          className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600">
          repor perdidas
        </button>
        <button onClick={() => setVideoNos(v => !v)}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${videoNos ? 'bg-sky-600 text-white' : 'border border-[#e7e5df] bg-white text-slate-600'}`}>
          nossa câmera
        </button>
        <button onClick={() => setVideoDele(v => !v)}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${videoDele ? 'bg-sky-600 text-white' : 'border border-[#e7e5df] bg-white text-slate-600'}`}>
          câmera do contato
        </button>
        <button onClick={() => setTelaCheia(v => !v)}
          className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${telaCheia ? 'bg-slate-800 text-white' : 'border border-[#e7e5df] bg-white text-slate-600'}`}>
          {telaCheia ? 'tela cheia' : 'painel flutuante'}
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

      {(videoNos || videoDele) && telaCheia && (
        <CallVideoScreen
          call={ativa}
          streams={streamsDeMentira}
          selfOrientation={giro}
          linkDown={semRede}
          videoSupported
          onMinimize={() => setTelaCheia(false)}
          onHangUp={() => { setVideoNos(false); setVideoDele(false); setFase('ENDED'); }}
          onToggleMute={() => setMudo(v => !v)}
          onToggleRecording={() => setGravando(v => !v)}
          onToggleVideo={() => setVideoNos(v => !v)}
          onRotateVideo={() => setGiro(g => (g + 1) % 4)}
          onOpenConversation={() => window.alert('abriria a conversa do contato')}
        />
      )}
      {/* Um OU outro, como no `WaCallsHost`: a tela cheia substitui o painel. */}
      {!((videoNos || videoDele) && telaCheia) && (
      <ActiveCallWidget
        call={ativa}
        linkDown={semRede}
        videoSupported
        videoStreams={videoNos || videoDele ? streamsDeMentira : undefined}
        videoOrientation={giro}
        onExpandVideo={() => setTelaCheia(true)}
        onToggleVideo={() => setVideoNos(v => !v)}
        onRotateVideo={() => setGiro(g => (g + 1) % 4)}
        guests={convidados}
        operators={EQUIPE_DEMO}
        me="eu"
        onInviteGuest={(userId, name, mode) => setConvidados([{ userId, name, mode, status: 'inviting' }])}
        onRemoveGuest={(userId) => setConvidados(atual => atual.filter(g => g.userId !== userId))}
        onHangUp={() => setFase('ENDED')}
        onToggleMute={() => setMudo(v => !v)}
        onToggleRecording={() => setGravando(v => !v)}
        onOpenConversation={() => window.alert('abriria a conversa do contato')}
      />
      )}
      {/* O aviso de chamada perdida: aqui ele é alimentado à mão, sem o store —
          a bancada confere o desenho e as ações, não a persistência. */}
      <MissedCallWidget
        calls={perdidas}
        canCall
        onCallBack={(call) => window.alert(`ligaria de volta para ${call.phone}`)}
        onOpenConversation={() => window.alert('abriria a conversa do contato')}
        onDismiss={(ids) => setPerdidas(atual => atual.filter(c => !ids.includes(c.callId)))}
        onDismissAll={() => setPerdidas([])}
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
