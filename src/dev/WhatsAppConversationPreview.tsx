// DEV-ONLY: bancada visual da thread do WhatsApp (?waconversationpreview=1).
// Usa as bolhas reais para validar densidade, agrupamento, áudio e responsividade
// sem depender de autenticação ou de dados de clientes.
import React, { useEffect, useState } from 'react';
import { MessageBubble } from '../components/whatsapp/messageBubble';
import { DateDivider } from '../components/whatsapp/conversationListItem';
import { DockedDetailsToggle } from '../components/whatsapp/DockedDetailsToggle';
import { useResizableLayout } from '../components/whatsapp/hooks/useResizableLayout';
// O topo do painel de detalhes entra aqui com os COMPONENTES REAIS: uma cópia
// decorativa dele foi justamente o que deixou a bancada mostrar um layout que o
// módulo já não tinha mais.
import { ContactIdentity, AttendanceSummary } from '../components/whatsapp/detailsPanelHeader';
import { ConversationLabelsPanel } from '../components/whatsapp/conversationLabels';
import { QuickActions } from '../components/whatsapp/quickActions';
import { ForwardMessageModal } from '../components/whatsapp/forwardMessageModal';
import { ToastProvider } from '../contexts/ToastContext';
import type { FunnelLabel } from '../services/settings.service';
import type { WhatsAppConversation, WhatsAppMessage } from '../types/whatsapp.types';
import { ArrowRightLeft, Download, History, MessageSquare, Mic, MoreVertical, Phone, Plus, Search, Sparkles, Video } from 'lucide-react';

const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
const PREVIEW_IMAGE = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="1280" viewBox="0 0 960 1280">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9fdd3"/><stop offset="1" stop-color="#8bd5c0"/></linearGradient></defs>
    <rect width="960" height="1280" fill="url(#g)"/><rect x="150" y="180" width="660" height="880" rx="32" fill="white" opacity=".88"/>
    <circle cx="480" cy="465" r="130" fill="#00a884" opacity=".18"/><path d="M340 830h280M340 890h210" stroke="#008069" stroke-width="28" stroke-linecap="round" opacity=".45"/>
  </svg>
`)}`;

function message(overrides: Partial<WhatsAppMessage> & Pick<WhatsAppMessage, 'id' | 'direction' | 'type' | 'wa_timestamp'>): WhatsAppMessage {
  return {
    conversation_id: 'preview-conversation',
    evolution_message_id: 'evo-' + overrides.id,
    content: null,
    media_url: null,
    media_mime: null,
    storage_path: null,
    media_size: null,
    media_sha256: null,
    file_name: null,
    transcription_text: null,
    transcription_status: null,
    reply_to_id: null,
    edited_at: null,
    status: 'read',
    sender_user_id: null,
    created_at: overrides.wa_timestamp,
    ...overrides,
  };
}

const AUDIO = message({
  id: 'audio',
  direction: 'in',
  type: 'audio',
  wa_timestamp: '2026-08-04T15:08:00.000Z',
  media_url: SILENT_WAV,
  media_mime: 'audio/wav',
  transcription_status: 'done',
  transcription_text: 'Olá, doutor, bom dia. A atendente do INSS informou que o resultado poderia ser consultado pelo telefone 135. O senhor consegue verificar para mim?',
});

const FIRST_OUT = message({
  id: 'out-1',
  direction: 'out',
  type: 'text',
  wa_timestamp: '2026-08-04T15:09:00.000Z',
  content: 'Há sim. Eu já consultei, mas o resultado ainda não está disponível.',
  sender_user_id: 'pedro',
});

const SECOND_OUT = message({
  id: 'out-2',
  direction: 'out',
  type: 'text',
  wa_timestamp: '2026-08-04T15:10:00.000Z',
  content: 'Depois do almoço vou acessar novamente e lhe aviso por aqui.',
  sender_user_id: 'pedro',
});

const OK = message({
  id: 'ok',
  direction: 'in',
  type: 'text',
  wa_timestamp: '2026-08-04T15:10:30.000Z',
  content: 'Ok, doutor. Obrigada!',
});

const LAST_OUT = message({
  id: 'out-3',
  direction: 'out',
  type: 'text',
  wa_timestamp: '2026-08-04T17:32:00.000Z',
  content: 'Boa tarde! O senhor conseguiu realizar a alteração da senha do Meu INSS?',
  sender_user_id: 'pedro',
});

const PREVIEW_PHOTO = message({
  id: 'photo',
  direction: 'in',
  type: 'image',
  wa_timestamp: '2026-08-04T15:11:00.000Z',
});

// Print de celular: bem mais alto que largo. É o formato que mais chega no
// atendimento (o cliente fotografa a tela do Meu INSS, do banco, do processo) e
// o que revelava a bolha com faixas cinza sobrando dos dois lados.
const PHONE_SHOT = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="2340" viewBox="0 0 1080 2340">
    <rect width="1080" height="2340" fill="#ffffff"/>
    <rect width="1080" height="90" fill="#111827"/>
    <rect x="70" y="220" width="820" height="70" rx="10" fill="#1f2937"/>
    <rect x="70" y="320" width="700" height="70" rx="10" fill="#1f2937"/>
    <rect x="70" y="480" width="940" height="26" rx="13" fill="#9ca3af"/>
    <rect x="70" y="540" width="880" height="26" rx="13" fill="#9ca3af"/>
    <rect x="70" y="600" width="910" height="26" rx="13" fill="#9ca3af"/>
    <rect x="70" y="1800" width="940" height="300" rx="16" fill="#374151"/>
  </svg>
`)}`;

const PHONE_SHOT_MSG = message({
  id: 'phone-shot',
  direction: 'in',
  type: 'image',
  wa_timestamp: '2026-08-04T15:12:00.000Z',
  media_url: PHONE_SHOT,
  media_mime: 'image/svg+xml',
});

// Paisagem larga: o outro extremo, para conferir que a bolha veste os dois.
const WIDE_SHOT = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="700" viewBox="0 0 1600 700">
    <rect width="1600" height="700" fill="#dbeafe"/>
    <circle cx="1300" cy="160" r="90" fill="#fbbf24"/>
    <path d="M0 520 L380 280 L700 520 L1050 330 L1600 620 L1600 700 L0 700 Z" fill="#1d4ed8" opacity=".55"/>
  </svg>
`)}`;

const WIDE_SHOT_MSG = message({
  id: 'wide-shot',
  direction: 'in',
  type: 'image',
  wa_timestamp: '2026-08-04T15:13:00.000Z',
  media_url: WIDE_SHOT,
  media_mime: 'image/svg+xml',
});

// Figurinha (webp/png com fundo transparente): tem que aparecer solta sobre a
// conversa, não como cartão de arquivo.
const STICKER = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <circle cx="256" cy="256" r="200" fill="#fde047"/>
    <circle cx="196" cy="214" r="26" fill="#1f2937"/><circle cx="316" cy="214" r="26" fill="#1f2937"/>
    <path d="M164 306a100 100 0 0 0 184 0" stroke="#1f2937" stroke-width="26" fill="none" stroke-linecap="round"/>
  </svg>
`)}`;

const STICKER_MSG = message({
  id: 'sticker',
  direction: 'in',
  type: 'sticker',
  wa_timestamp: '2026-08-04T15:14:00.000Z',
  media_url: STICKER,
  media_mime: 'image/webp',
});

// Áudio com transcrição: ela precisa estar legível de cara, sem clique.
const AUDIO_TRANSCRITO = message({
  id: 'audio-2',
  direction: 'in',
  type: 'audio',
  wa_timestamp: '2026-08-04T15:15:00.000Z',
  media_url: SILENT_WAV,
  media_mime: 'audio/wav',
  transcription_status: 'done',
  transcription_text: 'Doutor, consegui abrir o aplicativo. Aparece que o benefício está em análise desde o dia doze. Preciso levar mais algum documento na agência?',
});

// PDF de mentira (2 páginas, montado na hora com pdf-lib): serve para conferir
// a miniatura da 1ª página no balão e o visualizador em tela cheia.
const PDF_MSG = message({
  id: 'pdf',
  direction: 'in',
  type: 'document',
  wa_timestamp: '2026-08-04T15:16:00.000Z',
  media_mime: 'application/pdf',
  file_name: 'Contrato de honorarios.pdf',
  media_size: 148_320,
});

// Vídeo VERTICAL de mentira (9:16), gravado na hora de um canvas. É o formato
// que mais chega no atendimento — cliente filma com o celular na vertical — e
// era justamente ele que aparecia com faixas vazias dos lados na bolha.
const PREVIEW_VIDEO = message({
  id: 'video',
  direction: 'in',
  type: 'video',
  wa_timestamp: '2026-08-04T15:17:00.000Z',
  media_mime: 'video/webm',
  file_name: 'video-do-cliente.webm',
  media_size: 380_400,
});

async function buildPreviewVideo(): Promise<string | null> {
  if (typeof MediaRecorder === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 405;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const stream = canvas.captureStream(15);
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(resolve => { rec.onstop = () => resolve(); });
  rec.start();
  let t = 0;
  const timer = window.setInterval(() => {
    t += 1;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 405, 720);
    ctx.fillStyle = `hsl(${(t * 14) % 360} 70% 55%)`;
    ctx.beginPath();
    ctx.arc(202, 300 + Math.sin(t / 3) * 90, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 26px system-ui';
    ctx.fillText('video vertical 9:16', 60, 620);
  }, 66);
  window.setTimeout(() => { window.clearInterval(timer); rec.stop(); }, 1500);
  await done;
  return URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
}

async function buildPreviewPdf(): Promise<string> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const [index, titulo] of ['CONTRATO DE HONORARIOS', 'CLAUSULA SEGUNDA'].entries()) {
    const page = doc.addPage([595, 842]);
    page.drawText(titulo, { x: 60, y: 760, size: 18, font: bold, color: rgb(0.1, 0.1, 0.12) });
    for (let linha = 0; linha < 18; linha++) {
      page.drawText(`Linha ${linha + 1} da pagina ${index + 1} do documento de exemplo usado na bancada.`,
        { x: 60, y: 710 - linha * 26, size: 11, font, color: rgb(0.35, 0.38, 0.42) });
    }
  }
  const bytes = await doc.save();
  return URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
}

// Conversa de mentira para o painel de detalhes. Uma foto de verdade (retrato
// gerado) porque o avatar grande é justamente o que se quer conferir aqui.
const CONTACT_PHOTO = `data:image/svg+xml,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
    <defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient></defs>
    <rect width="240" height="240" fill="url(#b)"/>
    <circle cx="120" cy="96" r="42" fill="#fff" opacity=".92"/>
    <path d="M40 232c6-46 38-72 80-72s74 26 80 72Z" fill="#fff" opacity=".92"/>
  </svg>
`)}`;

const PREVIEW_CONVERSATION: WhatsAppConversation = {
  id: 'preview-conversation', instance_id: 'canal', remote_jid: 'preview@s.whatsapp.net',
  contact_phone: '5565984046375', contact_name: 'Lisliandra Inocêncio',
  contact_avatar_path: null, contact_avatar_url: CONTACT_PHOTO,
  client_id: 'cli-1', client_name: null,
  assigned_user_id: 'dr-pedro', department_id: 'previdenciario',
  status: 'open', unread_count: 0,
  last_message_at: '2026-08-04T15:15:00.000Z', last_message_preview: null, last_message_direction: 'in',
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: '2026-08-04T15:15:00.000Z', last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null,
  labels: ['Atendimento'],
  legal_hold: false, legal_hold_reason: null, absence_suppressed: false,
  created_at: '2026-08-04T12:00:00.000Z', updated_at: '2026-08-04T15:15:00.000Z',
};

/** Outras conversas para conferir o modal de encaminhar. */
const FORWARD_TARGETS: WhatsAppConversation[] = [
  ['conv-2', '5565992216459', 'Marcos Antônio Silva', 'MARCOS ANTONIO SILVA'],
  ['conv-3', '5565984112233', 'Joana Pereira', null],
  ['conv-4', '5511987654321', 'Escritório — parceiro SP', null],
  ['conv-5', '5565998877665', 'Dona Célia (mãe do cliente)', null],
].map(([id, phone, contact, client]) => ({
  ...PREVIEW_CONVERSATION,
  id: id!, contact_phone: phone!, contact_name: contact!, client_name: client ?? null,
  contact_avatar_url: null, labels: [],
}));

const PREVIEW_FUNNEL: FunnelLabel[] = [
  { key: 'Novo', stageKey: 'novo', stageLabel: 'Novo contato', color: '#0ea5e9', bg: '#0ea5e922' },
  { key: 'Atendimento', stageKey: 'em_atendimento', stageLabel: 'Em atendimento', color: '#dc2626', bg: '#dc262622' },
  { key: 'Proposta', stageKey: 'proposta', stageLabel: 'Proposta enviada', color: '#7c3aed', bg: '#7c3aed22' },
];

const noop = () => {};
const bubbleActions = {
  onReply: noop,
  onEdit: noop,
  onOpenImage: noop,
  onRetry: noop,
  onDiscard: noop,
  onResend: noop,
  onCancel: noop,
  onCreateDeadline: noop,
  onCreateTask: noop,
};

export default function WhatsAppConversationPreview() {
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const { panelWidth, startPanelResize } = useResizableLayout();
  const [previewImageReady, setPreviewImageReady] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => {
    const timeout = window.setTimeout(() => setPreviewImageReady(true), 5_000);
    return () => window.clearTimeout(timeout);
  }, []);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // Encaminhar: a bancada abre o modal de verdade, com conversas de mentira.
  const [forwardSource, setForwardSource] = useState<WhatsAppMessage | null>(null);
  useEffect(() => {
    let url: string | null = null;
    buildPreviewPdf().then(out => { url = out; setPdfUrl(out); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);
  useEffect(() => {
    let url: string | null = null;
    buildPreviewVideo().then(out => { url = out; setVideoUrl(out); });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, []);

  return (
    // O painel de etiquetas avisa por toast quando o salvamento falha — sem
    // Provider ele nem monta.
    <ToastProvider>
    <div className="min-h-screen bg-slate-200 p-4 lg:p-8">
      <div className="relative mx-auto flex h-[calc(100vh-2rem)] max-w-[1180px] overflow-hidden rounded-xl bg-white shadow-2xl lg:h-[calc(100vh-4rem)]">
        <section data-preview-thread className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-black/[0.06] bg-[#f0f2f5] px-4 py-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d9fdd3] text-sm font-bold text-[#008069]">LI</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold text-[#111b21]">Lisliandra Inocêncio</p>
            <p className="text-[11.5px] text-[#667781]">online · atendimento com Dr. Pedro</p>
          </div>
          <div className="flex items-center gap-1 text-[#54656f]">
            {[Video, Phone, Search, MoreVertical].map((Icon, index) => (
              <button key={index} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-black/[0.06]"><Icon size={18} /></button>
            ))}
          </div>
        </header>

        <main className="wa-thread-bg flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1050px] px-5 py-4">
            <DateDivider label="Hoje" />
            <MessageBubble m={AUDIO} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} onForward={setForwardSource} />
            <MessageBubble m={FIRST_OUT} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd={false} {...bubbleActions} />
            <MessageBubble m={SECOND_OUT} repliedTo={null} senderName={null} senderRole="Administrador" groupStart={false} groupEnd {...bubbleActions} />
            <MessageBubble m={OK} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} onForward={setForwardSource} />
            <MessageBubble m={{ ...PREVIEW_PHOTO, media_url: previewImageReady ? PREVIEW_IMAGE : null }} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} />
            <MessageBubble m={PHONE_SHOT_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} />
            <MessageBubble m={WIDE_SHOT_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} />
            {/* Vídeo vertical seguido de figurinha: o par que mostrava a bolha
                com faixas vazias e a figurinha grudada no player. */}
            <MessageBubble m={{ ...PREVIEW_VIDEO, media_url: videoUrl }} repliedTo={null} senderName={null} groupStart groupEnd={false} {...bubbleActions} />
            <MessageBubble m={STICKER_MSG} repliedTo={null} senderName={null} groupStart={false} groupEnd {...bubbleActions} />
            <MessageBubble m={{ ...PDF_MSG, media_url: pdfUrl, storage_path: pdfUrl ? 'preview/contrato.pdf' : null }} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} onForward={setForwardSource} />
            {/* O mesmo PDF saindo do escritório: o cartão tem que vestir bem a bolha verde também. */}
            <MessageBubble m={{ ...PDF_MSG, id: 'pdf-out', direction: 'out', sender_user_id: 'pedro', media_url: pdfUrl, storage_path: pdfUrl ? 'preview/contrato.pdf' : null, content: 'Segue o contrato para conferência.' }} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd {...bubbleActions} />
            <MessageBubble m={AUDIO_TRANSCRITO} repliedTo={null} senderName={null} groupStart groupEnd {...bubbleActions} />
            <MessageBubble m={LAST_OUT} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd {...bubbleActions} />
          </div>
        </main>

        <footer className="flex items-end gap-2 border-t border-black/[0.06] bg-[#f0f2f5] px-3 py-2">
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/[0.06]"><Plus size={22} /></button>
          <textarea rows={1} placeholder="Digite uma mensagem…"
            className="min-h-10 flex-1 resize-none rounded-xl border border-transparent bg-white px-3.5 py-2.5 text-[14px] leading-5 outline-none focus:border-[#00a884]/35" />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/[0.06] hover:text-[#00a884]"><Mic size={19} /></button>
        </footer>
        </section>

        {!detailsCollapsed && (
          <div onPointerDown={startPanelResize} role="separator" aria-orientation="vertical"
            className="relative w-1.5 shrink-0 touch-none cursor-col-resize bg-transparent">
            <DockedDetailsToggle collapsed={false} onToggle={() => setDetailsCollapsed(true)} />
          </div>
        )}
        {detailsCollapsed && (
          <DockedDetailsToggle collapsed onToggle={() => setDetailsCollapsed(false)} />
        )}

        <aside
          data-preview-details
          data-testid="whatsapp-details-panel"
          aria-hidden={detailsCollapsed}
          style={{ width: detailsCollapsed ? 0 : panelWidth }}
          className={`shrink-0 bg-white transition-[width,opacity,padding] duration-200 ${detailsCollapsed ? 'overflow-hidden p-0 opacity-0' : 'overflow-y-auto border-l border-[#e7e5df] p-3.5 opacity-100'}`}
        >
          {/* Espelha a ordem real do painel: quem é → como está o atendimento →
              o que eu faço agora → como está classificado. Usa os componentes de
              verdade (e não cópias à mão), para a bancada não mentir quando eles
              mudarem. */}
          <ContactIdentity conversation={PREVIEW_CONVERSATION} privateMode={false} onOpenPhoto={noop} />
          <div className="mt-2 space-y-4">
            <AttendanceSummary
              assignee="Dr. Pedro"
              department="Previdenciário"
              stage={{ stageLabel: 'Em atendimento', color: '#dc2626' }}
            />
            <QuickActions
              blocked={false}
              onMarkUnread={noop}
              onTransfer={noop}
              onTemplates={noop}
              onTimeline={noop}
              onSummary={noop}
              onExport={noop}
              onBlock={noop}
            />
            <div className="space-y-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Etiquetas</p>
              <ConversationLabelsPanel
                conversation={PREVIEW_CONVERSATION}
                funnelLabels={PREVIEW_FUNNEL}
                onChanged={noop}
              />
            </div>
            <div className="rounded-xl border border-[#e7e5df] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente vinculado</p>
              <p className="mt-2 text-[12px] font-bold text-slate-800">PEDRO RODRIGUES MONTALVAO NETO</p>
              <p className="mt-1 text-[11px] text-slate-400">045.448.031-93 · Ativo</p>
            </div>
          </div>
        </aside>
      </div>

      {forwardSource && (
        <ForwardMessageModal
          message={forwardSource}
          conversations={FORWARD_TARGETS}
          currentConversationId={PREVIEW_CONVERSATION.id}
          sending={false}
          onClose={() => setForwardSource(null)}
          onConfirm={() => setForwardSource(null)}
        />
      )}
    </div>
    </ToastProvider>
  );
}
