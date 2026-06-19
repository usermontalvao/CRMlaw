// Helpers puros (sem JSX/React) do módulo WhatsApp: formatação de data/telefone/
// bytes, presença, rótulos, identidade do agente e sinais de status/SLA. Extraídos
// de WhatsAppModule.tsx para reduzir o monólito; os componentes que os consomem
// continuam importando daqui. Sem efeitos colaterais — só funções determinísticas.
import type {
  WhatsAppConversation, WhatsAppMessage, WhatsAppPresence, WhatsAppDirection,
} from '../../types/whatsapp.types';
import type { StaffOption } from '../../services/whatsapp.service';

export const formatTime = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export const initials = (name: string | null, phone: string) => {
  const base = (name || phone || '?').trim();
  const parts = base.split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || base.slice(0, 2).toUpperCase();
};

export const prettyPhone = (phone: string) => {
  const d = (phone || '').replace(/\D/g, '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return phone.startsWith('+') ? phone : `+${d}`;
};

export const formatBytes = (n: number | null) => {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

/** "visto por último" com data e hora reais, no estilo do WhatsApp. */
export const lastSeenLabel = (iso: string) => {
  const d = new Date(iso);
  const hhmm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yest = new Date(); yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `visto por último hoje às ${hhmm}`;
  if (d.toDateString() === yest.toDateString()) return `visto por último ontem às ${hhmm}`;
  return `visto por último em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} às ${hhmm}`;
};

/**
 * Presença a exibir no cabeçalho. Oportunista e com janela de validade: sinais
 * ao vivo (online/digitando/gravando) só valem se recentes, senão caem para
 * "visto por último" quando houver. Retorna null quando não há nada confiável.
 */
export const presenceInfo = (c: { presence: WhatsAppPresence; presence_updated_at: string | null; last_seen_at: string | null }):
  { text: string; live: boolean } | null => {
  const age = c.presence_updated_at ? Date.now() - new Date(c.presence_updated_at).getTime() : Infinity;
  const fresh = (ms: number) => age <= ms;
  if (c.presence === 'composing' && fresh(25_000)) return { text: 'digitando…', live: true };
  if (c.presence === 'recording' && fresh(25_000)) return { text: 'gravando áudio…', live: true };
  if (c.presence === 'available' && fresh(75_000)) return { text: 'online', live: true };
  // Offline ou sinal antigo → "visto por último". Quando o WhatsApp não envia o
  // lastSeen explícito (caso comum), usamos o instante do último sinal de
  // presença como melhor estimativa honesta de quando o contato esteve ativo.
  const seenIso = c.last_seen_at || c.presence_updated_at;
  if (seenIso) return { text: lastSeenLabel(seenIso), live: false };
  return null;
};

export const typeLabel = (t: string) =>
  t === 'image' ? '📷 Imagem' : t === 'audio' ? '🎤 Áudio' : t === 'video' ? '🎬 Vídeo'
    : t === 'document' ? '📎 Documento' : '📎 Anexo';

export const conversationPreviewLabel = (type: WhatsAppMessage['type'], text?: string | null, fileName?: string | null) => {
  const trimmed = text?.trim();
  if (trimmed) return trimmed;
  if (type === 'image') return 'Imagem';
  if (type === 'audio') return 'Audio';
  if (type === 'video') return 'Video';
  if (type === 'document') return fileName || 'Documento';
  return 'Mensagem';
};

// ── Identidade do agente (Fase 1) ──
// Tratamento Dr./Dra. só para advogados (cargo "advogado" ou OAB preenchida),
// conforme o gênero do perfil. Demais cargos usam só o primeiro nome.
export const normalizeRoleStr = (r?: string | null) =>
  (r || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const firstName = (name?: string | null) => (name || '').trim().split(/\s+/)[0] || '';
export const isLawyer = (s?: Partial<StaffOption> | null) =>
  !!s && (normalizeRoleStr(s.role) === 'advogado' || !!(s.oab && s.oab.trim()));
export const treatmentOf = (s?: Partial<StaffOption> | null) =>
  isLawyer(s) ? (s!.gender === 'male' ? 'Dr.' : s!.gender === 'female' ? 'Dra.' : '') : '';
/** Rótulo de exibição do agente: "Dr. Pedro", "Dra. Ana" ou só "Carla". */
export const agentLabel = (s?: Partial<StaffOption> | null, shortNameOverride?: string | null) => {
  if (!s) return null;
  const fn = firstName(shortNameOverride || s.name);
  const t = treatmentOf(s);
  return t ? `${t} ${fn}` : fn;
};
export const greetingByHour = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
};
/** Saudação inicial automática do 1º atendimento (Fase 1). */
export const buildGreeting = (_s: Partial<StaffOption>, _roleLabelOverride?: string | null) => `${greetingByHour()}!`;
/** Apresentação do novo responsável ao aceitar uma transferência (Fase 4). */
export const buildAcceptPresentation = (s: Partial<StaffOption>, shortNameOverride?: string | null) => {
  const name = firstName(shortNameOverride || s.name);
  return `Olá! Sou ${name} e vou seguir com o seu atendimento a partir de agora.`;
};

// ── Status operacional + SLA (Fase 4 + A) ──
// Status derivado do estado real da conversa (sem campo de texto livre):
// bloqueado / encerrada / aguardando você / aguardando setor / aguardando cliente / aberta.
export type ConvStatusKey = 'blocked' | 'closed' | 'waiting_you' | 'waiting_internal' | 'waiting_client' | 'open';
export const convStatus = (c: {
  is_blocked: boolean;
  status: string;
  last_message_direction: WhatsAppDirection | null;
  assigned_user_id?: string | null;
  department_id?: string | null;
  awaiting_accept?: boolean;
}): { key: ConvStatusKey; label: string; cls: string } => {
  if (c.is_blocked) return { key: 'blocked', label: 'Bloqueado', cls: 'bg-red-100 text-red-600' };
  if (c.status === 'closed') return { key: 'closed', label: 'Encerrada', cls: 'bg-slate-200 text-slate-600' };
  if (c.last_message_direction === 'in') return { key: 'waiting_you', label: 'Aguardando você', cls: 'bg-amber-100 text-amber-700' };
  // Na fila de um setor mas sem responsável atribuído (e sem aceite pendente de transferência pessoal)
  if (!c.assigned_user_id && c.department_id && !c.awaiting_accept) return { key: 'waiting_internal', label: 'Aguardando setor', cls: 'bg-sky-100 text-sky-700' };
  if (c.last_message_direction === 'out') return { key: 'waiting_client', label: 'Aguardando cliente', cls: 'bg-slate-100 text-slate-500' };
  return { key: 'open', label: 'Aberta', cls: 'bg-emerald-100 text-emerald-700' };
};

/** Minutos parados aguardando nossa resposta (cliente foi o último a falar). */
export const waitingMinutes = (c: WhatsAppConversation): number | null => {
  if (c.is_blocked || c.status === 'closed') return null;
  if (c.last_message_direction !== 'in') return null;
  const since = c.last_customer_message_at || c.last_message_at;
  if (!since) return null;
  return (Date.now() - new Date(since).getTime()) / 60000;
};

/** Sinal de SLA: atenção (>15min) ou estourado (>60min). null = sem alerta. */
export const slaSignal = (c: WhatsAppConversation): { color: string; label: string } | null => {
  const m = waitingMinutes(c);
  if (m == null || m < 15) return null;
  const human = m < 60 ? `${Math.floor(m)}min` : `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, '0')}`;
  return m >= 60
    ? { color: '#dc2626', label: `parada há ${human}` }
    : { color: '#d97706', label: `parada há ${human}` };
};

/**
 * Sinal de SLA interno (Fase B): conversa em fila de setor sem responsável há muito tempo.
 * Usa last_message_at como proxy do momento em que entrou na fila.
 * null = sem alerta (conversa não está em fila ou tempo aceitável).
 */
export const slaInternalSignal = (c: WhatsAppConversation): { color: string; label: string } | null => {
  if (convStatus(c).key !== 'waiting_internal') return null;
  const since = c.last_message_at;
  if (!since) return null;
  const m = (Date.now() - new Date(since).getTime()) / 60000;
  if (m < 30) return null;
  const human = m < 60 ? `${Math.floor(m)}min` : `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, '0')}`;
  return m >= 120
    ? { color: '#dc2626', label: `na fila há ${human}` }
    : { color: '#d97706', label: `na fila há ${human}` };
};

/**
 * Fase N: conversa com responsável atribuído que não respondeu em >4h após última
 * mensagem do cliente. Mais grave que slaSignal (15min) — sinaliza abandono real.
 */
export const abandonedSignal = (c: WhatsAppConversation): { label: string } | null => {
  if (!c.assigned_user_id || c.is_blocked || c.status === 'closed') return null;
  if (c.last_message_direction !== 'in') return null;
  const since = c.last_customer_message_at || c.last_message_at;
  if (!since) return null;
  const h = (Date.now() - new Date(since).getTime()) / 3600000;
  if (h < 4) return null;
  const label = h < 24 ? `${Math.floor(h)}h sem resposta` : `${Math.floor(h / 24)}d sem resposta`;
  return { label };
};

/**
 * Alerta de transferência sem aceite/continuidade (Fase 4). Enquanto a conversa
 * está "aguardando aceite", sinaliza o tempo parado: neutro no início, atenção
 * (>15min) e estourado (>60min) — para a operação ver o gargalo antes de virar
 * problema. null = não há transferência pendente.
 */
export const transferAlert = (c: WhatsAppConversation): { color: string; label: string } | null => {
  if (!c.awaiting_accept || c.is_blocked || c.status === 'closed') return null;
  const since = c.transfer_pending_since;
  const m = since ? (Date.now() - new Date(since).getTime()) / 60000 : 0;
  if (m < 15) return { color: '#0ea5e9', label: 'aguardando aceite' };
  const human = m < 60 ? `${Math.floor(m)}min` : `${Math.floor(m / 60)}h${String(Math.floor(m % 60)).padStart(2, '0')}`;
  return m >= 60
    ? { color: '#dc2626', label: `sem aceite há ${human}` }
    : { color: '#d97706', label: `sem aceite há ${human}` };
};

// ── Mascaramento (Fase L: modo privado) ──
/** Oculta CPF (###.###.###-##) e telefones (10-13 dígitos) no texto. */
export function maskSensitive(text: string): string {
  return text
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '***.***.***-**')
    .replace(/\b(\+?55\s?)?(\(?\d{2}\)?\s?)(\d{4,5}[-\s]?\d{4})\b/g, '(**) *****-****');
}
/** No modo privado, reduz o nome do contato a iniciais (preserva orientação visual sem expor o nome). */
export function maskName(name: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'Contato';
  return parts.map(p => `${p[0].toUpperCase()}•••`).join(' ');
}
/** Telefone totalmente oculto no modo privado. */
export function maskPhoneFull(): string { return '•••• ••••'; }

/** Duração de áudio em m:ss (defensivo contra NaN/negativos). */
export const fmtAudioTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

/** Formata CPF/CNPJ a partir dos dígitos crus. */
export const prettyDoc = (doc: string | null) => {
  if (!doc) return '';
  const d = doc.replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return doc;
};

/** Vencimento relativo (vencido/hoje/amanhã/em N dias) com tom de cor. */
export function dueInfo(iso: string): { label: string; tone: 'red' | 'amber' | 'slate' } {
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff < 0) return { label: `vencido há ${-diff}d`, tone: 'red' };
  if (diff === 0) return { label: 'vence hoje', tone: 'amber' };
  if (diff === 1) return { label: 'amanhã', tone: 'amber' };
  if (diff <= 7) return { label: `em ${diff} dias`, tone: 'slate' };
  return { label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), tone: 'slate' };
}

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const fmtNoteDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Título de tarefa/prazo derivado de uma mensagem. */
export function msgTitle(m: WhatsAppMessage): string {
  if (m.content) return m.content.slice(0, 80).trim();
  if (m.file_name) return m.file_name;
  return typeLabel(m.type);
}
/** Descrição de tarefa/prazo derivada de uma mensagem. */
export function msgDescription(m: WhatsAppMessage): string {
  return `Originado da conversa WhatsApp em ${new Date(m.wa_timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.\n${m.content || ''}`.trim();
}
