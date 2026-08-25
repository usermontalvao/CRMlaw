// DEV-ONLY: bancada visual da thread do WhatsApp (?waconversationpreview=1).
// Usa as bolhas reais para validar densidade, agrupamento, áudio e responsividade
// sem depender de autenticação ou de dados de clientes.
import React, { useEffect, useState } from 'react';
import { MessageBubble, ImageAlbum } from '../components/whatsapp/messageBubble';
import { EmojiPicker } from '../components/whatsapp/emojiPicker';
import { DateDivider } from '../components/whatsapp/conversationListItem';
import { DockedDetailsToggle } from '../components/whatsapp/DockedDetailsToggle';
import { useResizableLayout } from '../components/whatsapp/hooks/useResizableLayout';
// O topo do painel de detalhes entra aqui com os COMPONENTES REAIS: uma cópia
// decorativa dele foi justamente o que deixou a bancada mostrar um layout que o
// módulo já não tinha mais.
import { ContactIdentity, AttendanceSummary } from '../components/whatsapp/detailsPanelHeader';
import { ConversationStageSelect } from '../components/whatsapp/conversationLabels';
import { QuickActions } from '../components/whatsapp/quickActions';
import { ForwardMessageModal } from '../components/whatsapp/forwardMessageModal';
import { ThreadCallEntry, type ThreadCall } from '../components/whatsapp/threadCallEntry';
import { seedContactProbes } from '../components/whatsapp/contactProbes';
import { PreCadastroModal } from '../components/whatsapp/preCadastroModal';
import { AiHandoffSummaryCard, AiHandoffSummaryStrip, useAiHandoffSummary } from '../components/whatsapp/aiHandoffSummary';
import { ToastProvider, useToastContext } from '../contexts/ToastContext';
import { copiarTexto } from '../utils/copyText';
import type { FunnelLabel } from '../services/settings.service';
import type { WhatsAppAiConversationState, WhatsAppConversation, WhatsAppMessage } from '../types/whatsapp.types';
import { ArrowRightLeft, Download, History, MessageSquare, Mic, MoreVertical, Phone, Plus, Search, Smile, Sparkles, Video } from 'lucide-react';

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
  // Reação do CONTATO na nossa mensagem: a pastilha tem de caber na bolha
  // verde sem empurrar a hora nem a marca de entrega.
  reactions: [{ emoji: '👍', from: 'in', actor: 'contact', at: '2026-08-04T15:10:20.000Z' }],
});

const OK = message({
  id: 'ok',
  direction: 'in',
  type: 'text',
  wa_timestamp: '2026-08-04T15:10:30.000Z',
  content: 'Ok, doutor. Obrigada!',
  // Duas pastilhas na mesma bolha, uma delas NOSSA (fio na cor da casa): é o
  // caso em que a linha de reações precisa quebrar bem em tela estreita.
  reactions: [
    { emoji: '❤️', from: 'out', actor: 'office', name: 'Dr. Pedro', at: '2026-08-04T15:11:00.000Z' },
    { emoji: '🙏', from: 'in', actor: 'contact', at: '2026-08-04T15:11:10.000Z' },
  ],
});

// ── Tipos nativos do WhatsApp que o painel só recebe ──
// Todos apareciam como bolha BRANCA antes de o webhook aprender a lê-los. O
// conteúdo chega daqui já no formato que `wa-native-content.ts` produz.
const CONTATO_MSG = message({
  id: 'contato',
  direction: 'in',
  type: 'contact',
  wa_timestamp: '2026-08-04T15:20:00.000Z',
  content: 'Dra. Helena Prado\n+5565999887766\n\nCartório 2º Ofício\n+556533334444',
});

// Contato de UM número — o formato do WhatsApp: cartão clicável e rodapé de
// ações. É o caso comum, e o que a bancada precisa mostrar ao lado do de cima
// (dois números por pessoa muda o desenho: cada linha ganha as próprias ações).
const CONTATO_UM_MSG = message({
  id: 'contato-um',
  direction: 'in',
  type: 'contact',
  wa_timestamp: '2026-08-04T15:21:00.000Z',
  content: 'André Eletricista\n+556581121124',
});

// ── Chamadas de voz na thread ──
// Os quatro desfechos que mudam o que o atendente faz em seguida. A perdida
// recebida é a única vermelha: é dívida do escritório.
const CHAMADAS: ThreadCall[] = [
  {
    id: 'call-1', direction: 'outbound', outcome: 'answered',
    startedAt: '2026-08-04T15:22:00.000Z', durationSeconds: 372,
    userName: 'Dr. Pedro', recordingPath: 'call-recordings/demo.webm', transcript: null,
  },
  {
    id: 'call-2', direction: 'inbound', outcome: 'missed',
    startedAt: '2026-08-04T15:24:00.000Z', durationSeconds: 0,
    userName: null, recordingPath: null, transcript: null,
  },
  {
    id: 'call-3', direction: 'outbound', outcome: 'missed',
    startedAt: '2026-08-04T15:25:00.000Z', durationSeconds: 0,
    userName: null, recordingPath: null, transcript: null,
  },
  {
    id: 'call-4', direction: 'inbound', outcome: 'answered',
    startedAt: '2026-08-04T15:26:00.000Z', durationSeconds: 48,
    userName: 'Ana (recepção)', recordingPath: null,
    transcript: 'Cliente confirmou a perícia de quinta às 14h e vai levar o comprovante de residência.',
  },
];

const LOCALIZACAO_MSG = message({
  id: 'local',
  direction: 'in',
  type: 'location',
  wa_timestamp: '2026-08-04T15:21:00.000Z',
  content: 'Fórum de Cuiabá — Av. Historiador Rubens de Mendonça, 1894\n-15.601411, -56.097892\nhttps://www.google.com/maps/search/?api=1&query=-15.601411,-56.097892',
});

const ENQUETE_MSG = message({
  id: 'enquete',
  direction: 'in',
  type: 'poll',
  wa_timestamp: '2026-08-04T15:22:00.000Z',
  content: 'Qual horário fica melhor para a perícia?\n• Terça, 9h\n• Quinta, 14h\n• Sexta, 16h',
});

const NAO_SUPORTADA_MSG = message({
  id: 'nao-suportada',
  direction: 'in',
  type: 'unsupported',
  wa_timestamp: '2026-08-04T15:23:00.000Z',
  content: 'Mensagem não suportada',
});

// Bolha vazia herdada: gravada como texto sem conteúdo antes do reconhecimento
// existir. Não há como consertá-la no banco — a tela é que precisa explicá-la.
const TEXTO_VAZIO_LEGADO = message({
  id: 'legado-branco',
  direction: 'in',
  type: 'text',
  wa_timestamp: '2026-08-04T15:24:00.000Z',
  content: null,
});

const LINKS_MSG = message({
  id: 'links',
  direction: 'in',
  type: 'text',
  wa_timestamp: '2026-08-04T15:25:00.000Z',
  content: 'Consultei em https://www.tjmt.jus.br/processo?num=123 e também em jurius.com.br.\nQualquer coisa me chama no pedro@jurius.com.br — o contrato.pdf eu envio depois.',
});

// Dois áudios seguidos: ao terminar o primeiro, o segundo emenda sozinho.
const AUDIO_EMENDA_A = message({
  id: 'audio-emenda-a',
  direction: 'in',
  type: 'audio',
  wa_timestamp: '2026-08-04T15:26:00.000Z',
  media_url: SILENT_WAV,
  media_mime: 'audio/wav',
});
const AUDIO_EMENDA_B = message({
  id: 'audio-emenda-b',
  direction: 'in',
  type: 'audio',
  wa_timestamp: '2026-08-04T15:26:30.000Z',
  media_url: SILENT_WAV,
  media_mime: 'audio/wav',
});

// ── Álbum: três imagens enviadas juntas ──
// Cada miniatura é uma MENSAGEM: o clique direito e a setinha têm de agir sobre
// a que foi clicada, e não sobre o grupo.
const ALBUM_ITENS = ['a', 'b', 'c', 'd', 'e'].map((sufixo, i) => message({
  id: `album-${sufixo}`,
  direction: 'out',
  type: 'image',
  wa_timestamp: `2026-08-04T15:27:0${i}.000Z`,
  sender_user_id: 'pedro',
  storage_path: `preview/album-${sufixo}.png`,
  media_url: `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
      <rect width="600" height="600" fill="hsl(${i * 62}, 62%, 62%)"/>
      <text x="300" y="340" font-size="180" font-family="system-ui" font-weight="bold" fill="#ffffff" text-anchor="middle">${i + 1}</text>
    </svg>
  `)}`,
  content: i === 0 ? 'Fotos da perícia, doutor.' : null,
  // A segunda imagem já tem reação NOSSA: clicar nela de novo tem de REMOVER.
  reactions: i === 1
    ? [{ emoji: '👍', from: 'out' as const, actor: 'office', name: 'Dr. Pedro', at: '2026-08-04T15:28:00.000Z' }]
    : undefined,
}));

// Bolha COLADA NA BORDA DIREITA e no rodapé: é ela que revela se o menu do
// clique direito sabe virar para cima e para dentro em vez de sair da tela.
const BORDA_OUT = message({
  id: 'borda-out',
  direction: 'out',
  type: 'text',
  wa_timestamp: '2026-08-04T17:31:00.000Z',
  content: 'Clique com o botão direito AQUI: o menu tem de virar para cima e caber inteiro.',
  sender_user_id: 'pedro',
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

// A sondagem de contato, semeada: a bancada não tem sessão para perguntar de
// verdade, e sem isto os três cartões ficariam iguais nas iniciais. Aqui a Dra.
// Helena tem foto, o André tem WhatsApp e não tem foto (o caso real que motivou
// a pergunta "por que não puxa a foto?" — a Evolution devolve `null`), e o
// cartório não tem WhatsApp.
seedContactProbes([
  { phone: '5565999887766', hasWhatsApp: true, avatarUrl: CONTACT_PHOTO },
  { phone: '556581121124', hasWhatsApp: true, avatarUrl: null },
  { phone: '556533334444', hasWhatsApp: false, avatarUrl: null },
]);

const PREVIEW_CONVERSATION: WhatsAppConversation = {
  id: 'preview-conversation', instance_id: 'canal', remote_jid: 'preview@s.whatsapp.net',
  contact_phone: '5565984046375', contact_name: 'Lisliandra Inocêncio',
  contact_avatar_path: null, contact_avatar_url: CONTACT_PHOTO,
  client_id: 'cli-1', client_name: null,
  assigned_user_id: 'dr-pedro', department_id: 'previdenciario',
  status: 'open', unread_count: 0,
  last_message_at: '2026-08-04T15:15:00.000Z', last_message_preview: null, last_message_direction: 'in',
  last_call_at: null, last_call_direction: null, last_call_outcome: null, last_call_duration_seconds: null,
  presence: null, presence_updated_at: null, last_seen_at: null,
  is_blocked: false, blocked_at: null, blocked_by: null, blocked_reason: null,
  closed_at: null, closed_by: null, closure_reason: null, reopened_at: null,
  first_response_at: null, last_customer_message_at: '2026-08-04T15:15:00.000Z', last_agent_message_at: null,
  awaiting_accept: false, transfer_pending_since: null, contact_reason: null,
  labels: ['Atendimento'],
  legal_hold: false, legal_hold_reason: null, absence_suppressed: false, auto_close_suppressed: false,
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
const HANDOFF_STATE: WhatsAppAiConversationState = {
  aiActive: false,
  assistantId: 'preview-assistant',
  assistantName: 'Triagem trabalhista',
  mode: 'auto',
  followupPolicy: {
    enabled: true,
    strategy: 'custom',
    intervalHours: 24,
    customHours: [2, 4, 8, 24, 48, 168, 240, 336],
    maxAttempts: 8,
    days: [1, 2, 3, 4, 5],
    startMinute: 480,
    endMinute: 1080,
    timezone: 'America/Cuiaba',
    inactivityMinutes: 10,
  },
  channelAiEnabled: true,
  status: 'handed_off',
  summary: 'Pedro trabalhou sem registro na Todimo, de janeiro a agosto (anos ainda não informados), como auxiliar. Recebia R$ 1.800 por Pix e trabalhava de segunda a sexta, das 8h às 18h, sob supervisão. Possui provas e testemunha.',
  knownFacts: {},
  pendingItems: ['confirmar o ano de início e de saída'],
  lastAction: 'transferir_atendimento',
  triageStage: null,
  triageCut: null,
  triageCutReason: null,
  handoffReason: 'Triagem concluída',
  handoffSummary: 'Pedro trabalhou sem registro na Todimo, de janeiro a agosto (anos ainda não informados), como auxiliar. Recebia R$ 1.800 por Pix e trabalhava de segunda a sexta, das 8h às 18h, sob supervisão. Possui provas e testemunha. Próximo passo: confirmar os anos e analisar os comprovantes.',
  nextFollowupAt: null,
  followupAttempts: 0,
  lastExecution: null,
  pendingFollowup: null,
};
const loadPreviewHandoff = async () => HANDOFF_STATE;
/** Na bancada nada é devolvido de verdade — só o estado visual do botão. */
const resumePreviewAi = async () => { await new Promise(r => setTimeout(r, 400)); };
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
  // Como o resto da bancada, a reação aqui não vai a lugar nenhum: o que se
  // confere neste arquivo é o desenho (pastilha, barra rápida, catálogo).
  onReact: noop,
  // Apagar existe só para o MENU ficar completo — nada some da bancada. Sem
  // este callback o item nem apareceria, e era o menu que se queria conferir.
  onDelete: noop,
};

/** O Provider precisa envolver ESTE componente: o resumo da IA é lido por um
 *  hook no corpo dele, e o hook fala com o toast. */
export default function WhatsAppConversationPreview() {
  return (
    <ToastProvider>
      <PreviewBench />
    </ToastProvider>
  );
}

function PreviewBench() {
  const toast = useToastContext();
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  // Largura de celular: é onde o TOQUE PROLONGADO se confere (no navegador,
  // com a emulação de toque ligada) e onde o menu do clique direito encosta
  // nas duas bordas ao mesmo tempo.
  const [movel, setMovel] = useState(false);
  const [emojiAberto, setEmojiAberto] = useState(false);
  const campoRef = React.useRef<HTMLTextAreaElement>(null);
  // Bancada das DUAS superfícies. O módulo cheio segue no bege com rabiscos; o
  // widget usa o creme liso do painel. São os mesmos componentes de verdade nos
  // dois casos — o que muda é a classe do chão, e é exatamente aí que moram as
  // regras de balão, rabinho e divisor do modo embutido.
  const [superficie, setSuperficie] = useState<'modulo' | 'widget'>('widget');
  // Espelha `molduraBg` do WhatsAppModule: a moldura acompanha o chão.
  const molduraBg = superficie === 'widget' ? 'bg-[#fdfcfb]' : 'bg-[#f0f2f5]';
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
  // Copiar é a ÚNICA ação da bancada que acontece de verdade: é o único jeito
  // de conferir que o que sai é o texto visível (sem marcas, sem a assinatura)
  // — basta colar em qualquer lugar depois de clicar.
  const acoes = React.useMemo(() => ({
    ...bubbleActions,
    // O menu da bancada mostra o conjunto CHEIO — inclusive prazo e tarefa,
    // que é onde ele fica mais alto e mais fácil de sair da tela.
    canCreateFollowups: true,
    onForward: setForwardSource,
    onCopy: async (_m: WhatsAppMessage, texto: string) => {
      if (await copiarTexto(texto)) toast.success('Mensagem copiada', texto.slice(0, 120));
      else toast.error('Não foi possível copiar');
    },
  }), [toast]);
  const [preCadastroOpen, setPreCadastroOpen] = useState(false);
  // A bancada lê o handoff uma vez, como o módulo: a faixa fina na thread e o
  // cartão do painel saem do mesmo estado.
  const handoffSummary = useAiHandoffSummary({
    conversationId: 'preview-conversation',
    currentUserId: 'pedro',
    assignedUserId: 'pedro',
    loadState: loadPreviewHandoff,
    resumeAi: resumePreviewAi,
  });
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
    <div className="min-h-screen bg-slate-200 p-4 lg:p-8">
      <div className="mx-auto mb-3 flex max-w-[1180px] items-center gap-2">
        {(['widget', 'modulo'] as const).map(op => (
          <button key={op} onClick={() => setSuperficie(op)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
              superficie === op ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
            }`}>
            {op === 'widget' ? 'Widget (creme liso)' : 'Módulo cheio (bege do app)'}
          </button>
        ))}
        <button onClick={() => setMovel(v => !v)}
          className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition ${
            movel ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
          }`}>
          {movel ? 'Largura de celular (390px)' : 'Largura cheia'}
        </button>
        <span className="ml-2 text-[11px] text-slate-500">
          Botão direito na bolha · toque prolongado (emulação de toque) · Escape, setas, Home/End no menu
        </span>
      </div>
      <div style={movel ? { width: 390 } : undefined}
        className={`relative mx-auto flex h-[calc(100vh-2rem)] overflow-hidden rounded-xl bg-white shadow-2xl lg:h-[calc(100vh-4rem)] ${movel ? '' : 'max-w-[1180px]'}`}>
        <section data-preview-thread className="flex min-w-0 flex-1 flex-col">
        <header className={`flex items-center gap-3 border-b border-black/[0.06] ${molduraBg} px-4 py-2.5`}>
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

        <AiHandoffSummaryStrip data={handoffSummary} onOpenPanel={() => undefined} />

        <main className={`${superficie === 'widget' ? 'wa-thread-bg-liso' : 'wa-thread-bg'} flex-1 overflow-y-auto overscroll-contain`}>
          <div className="mx-auto w-full max-w-[1050px] px-5 py-4">
            {/* UMA SEÇÃO POR DIA, como na thread de verdade. O <div> em volta é
                o que impede os divisores grudentos de pararem um em cima do
                outro; sem ele, "ONTEM" e "HOJE" se sobrepõem ao rolar. */}
            <div>
            <DateDivider label="Ontem" />
            <MessageBubble m={{ ...OK, id: 'ontem-1', content: 'Doutor, mandei os documentos ontem à noite.' }} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={{ ...OK, id: 'ontem-2', direction: 'out', sender_user_id: 'pedro', content: 'Recebido. Vou conferir e retorno amanhã.' }} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd {...acoes} />
            </div>
            <div>
            <DateDivider label="Hoje" />
            <MessageBubble m={AUDIO} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} onForward={setForwardSource} />
            <MessageBubble m={FIRST_OUT} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd={false} {...acoes} />
            <MessageBubble m={SECOND_OUT} repliedTo={null} senderName={null} senderRole="Administrador" groupStart={false} groupEnd {...acoes} />
            <MessageBubble m={OK} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} onForward={setForwardSource} />
            <MessageBubble m={{ ...PREVIEW_PHOTO, media_url: previewImageReady ? PREVIEW_IMAGE : null }} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={PHONE_SHOT_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={WIDE_SHOT_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            {/* Vídeo vertical seguido de figurinha: o par que mostrava a bolha
                com faixas vazias e a figurinha grudada no player. */}
            <MessageBubble m={{ ...PREVIEW_VIDEO, media_url: videoUrl }} repliedTo={null} senderName={null} groupStart groupEnd={false} {...acoes} />
            <MessageBubble m={STICKER_MSG} repliedTo={null} senderName={null} groupStart={false} groupEnd {...acoes} />
            <MessageBubble m={{ ...PDF_MSG, media_url: pdfUrl, storage_path: pdfUrl ? 'preview/contrato.pdf' : null }} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} onForward={setForwardSource} />
            {/* O mesmo PDF saindo do escritório: o cartão tem que vestir bem a bolha verde também. */}
            <MessageBubble m={{ ...PDF_MSG, id: 'pdf-out', direction: 'out', sender_user_id: 'pedro', media_url: pdfUrl, storage_path: pdfUrl ? 'preview/contrato.pdf' : null, content: 'Segue o contrato para conferência.' }} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd {...acoes} />
            {/* Mensagem que SAIU DE UM AGENDAMENTO: a marca é interna — existe
                nesta tela e não no aparelho do contato. Fica na bancada porque
                é ela que revela se o selo cabe na bolha sem empurrar o texto. */}
            <MessageBubble
              m={{ ...OK, id: 'agendada-out', direction: 'out', sender_user_id: 'pedro',
                   content: 'Bom dia! Passando para lembrar da audiência de amanhã, às 14h.' }}
              repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd
              scheduledAt={new Date(Date.now() - 3 * 60 * 60_000).toISOString()} {...acoes} />
            <MessageBubble m={AUDIO_TRANSCRITO} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />

            {/* Os tipos nativos que viravam bolha branca. */}
            {CHAMADAS.map(c => (
              <ThreadCallEntry key={c.id} call={c} onCallBack={() => window.alert('ligaria de volta')} />
            ))}
            <MessageBubble m={CONTATO_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes}
              onForward={setForwardSource}
              onOpenContactChat={(phone, name) => console.log('conversar', phone, name)}
              onCallContactPhone={(phone, name) => console.log('ligar', phone, name)}
              onLinkContactPhone={(phone, name) => console.log('vincular', phone, name)} />
            <MessageBubble m={CONTATO_UM_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes}
              onForward={setForwardSource}
              onOpenContactChat={(phone, name) => console.log('conversar', phone, name)}
              onCallContactPhone={(phone, name) => console.log('ligar', phone, name)}
              onLinkContactPhone={(phone, name) => console.log('vincular', phone, name)} />
            <MessageBubble m={LOCALIZACAO_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={ENQUETE_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={NAO_SUPORTADA_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />
            <MessageBubble m={TEXTO_VAZIO_LEGADO} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />

            {/* Links clicáveis + nome de arquivo que NÃO pode virar link. */}
            <MessageBubble m={LINKS_MSG} repliedTo={null} senderName={null} groupStart groupEnd {...acoes} />

            {/* Dois áudios seguidos: o segundo emenda no fim do primeiro. */}
            <MessageBubble m={AUDIO_EMENDA_A} repliedTo={null} senderName={null} groupStart groupEnd={false} nextAudioId={AUDIO_EMENDA_B.id} {...acoes} />
            <MessageBubble m={AUDIO_EMENDA_B} repliedTo={null} senderName={null} groupStart={false} groupEnd {...acoes} />

            {/* ÁLBUM: clique direito (ou toque prolongado) em CADA miniatura.
                A imagem 2 já tem reação nossa — clicar nela de novo remove. */}
            <ImageAlbum items={ALBUM_ITENS} out senderName="Dr. Pedro" groupStart
              privateMode={false} canCreateFollowups actions={acoes} onOpenImage={noop} />

            {/* As duas últimas: coladas no rodapé e na borda direita. É onde o
                menu precisa virar para cima e para dentro. */}
            <MessageBubble m={BORDA_OUT} repliedTo={null} senderName="Dr. Pedro" senderRole="Administrador" groupStart groupEnd={false} {...acoes} />
            <MessageBubble m={LAST_OUT} repliedTo={null} senderName={null} senderRole="Administrador" groupStart={false} groupEnd {...acoes} />
            </div>
          </div>
        </main>

        {/* Réplica da barra de envio. O seletor de emoji aqui é o COMPONENTE
            real, no mesmo lugar em que ele fica no módulo: é o que permite
            conferir que o painel cabe acima da barra nas duas superfícies. */}
        <footer className={`relative flex items-end gap-2 border-t border-black/[0.06] ${molduraBg} px-3 py-2`}>
          {emojiAberto && (
            <EmojiPicker className="absolute bottom-full left-3 z-30 mb-2 w-[320px] max-w-[calc(100%-1.5rem)]"
              onPick={emoji => { const el = campoRef.current; if (el) { el.value += emoji; el.focus(); } }}
              onClose={() => setEmojiAberto(false)} />
          )}
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/[0.06]"><Plus size={22} /></button>
          <button onClick={() => setEmojiAberto(v => !v)} aria-label="Emojis" aria-expanded={emojiAberto}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.06] ${emojiAberto ? 'text-[#00a884]' : 'text-[#54656f]'}`}>
            <Smile size={21} />
          </button>
          <textarea ref={campoRef} rows={1} placeholder="Digite uma mensagem…"
            className="min-h-10 flex-1 resize-none rounded-xl border border-transparent bg-white px-3.5 py-2.5 text-[14px] leading-5 outline-none focus:border-[#00a884]/35" />
          <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#54656f] hover:bg-black/[0.06] hover:text-[#00a884]"><Mic size={19} /></button>
        </footer>
        </section>

        {!movel && !detailsCollapsed && (
          <div onPointerDown={startPanelResize} role="separator" aria-orientation="vertical"
            className="relative w-1.5 shrink-0 touch-none cursor-col-resize bg-transparent">
            <DockedDetailsToggle collapsed={false} onToggle={() => setDetailsCollapsed(true)} />
          </div>
        )}
        {!movel && detailsCollapsed && (
          <DockedDetailsToggle collapsed onToggle={() => setDetailsCollapsed(false)} />
        )}

        <aside
          data-preview-details
          data-testid="whatsapp-details-panel"
          aria-hidden={movel || detailsCollapsed}
          style={{ width: movel || detailsCollapsed ? 0 : panelWidth }}
          className={`shrink-0 bg-white transition-[width,opacity,padding] duration-200 ${movel || detailsCollapsed ? 'overflow-hidden p-0 opacity-0' : 'overflow-y-auto border-l border-[#e7e5df] p-3.5 opacity-100'}`}
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
              stageControl={(
                <ConversationStageSelect
                  conversation={PREVIEW_CONVERSATION}
                  funnelLabels={PREVIEW_FUNNEL}
                  onChanged={noop}
                />
              )}
            />
            <AiHandoffSummaryCard data={handoffSummary} />
            <QuickActions
              blocked={false}
              onMarkUnread={noop}
              onTransfer={noop}
              onTemplates={noop}
              onTimeline={noop}
              onSummary={noop}
              onExport={noop}
              onBlock={noop}
              muted={false}
              onMute={noop}
              onUnmute={noop}
            />
            <div className="rounded-xl border border-[#e7e5df] p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Cliente vinculado</p>
              <p className="mt-2 text-[12px] font-bold text-slate-800">PEDRO RODRIGUES MONTALVAO NETO</p>
              <p className="mt-1 text-[11px] text-slate-400">045.448.031-93 · Ativo</p>
            </div>
            {/* Conversa sem cadastro: o formulário de pré-cadastro é o que
                destrava prazo, agenda e documento. Aqui só para olhar o
                componente de verdade — gravar exige banco. */}
            <button onClick={() => setPreCadastroOpen(true)}
              className="w-full rounded-lg bg-sky-50 px-3 py-1.5 text-[12px] font-semibold text-sky-700 hover:bg-sky-100">
              Abrir pré-cadastro (bancada)
            </button>
          </div>
        </aside>
      </div>

      {preCadastroOpen && (
        <PreCadastroModal
          conversationId={PREVIEW_CONVERSATION.id}
          phone={PREVIEW_CONVERSATION.contact_phone}
          suggestedName={PREVIEW_CONVERSATION.contact_name}
          reason="Para marcar um compromisso, precisamos saber de quem é."
          onClose={() => setPreCadastroOpen(false)}
          onCreated={() => setPreCadastroOpen(false)}
        />
      )}

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
  );
}
