// DEV-ONLY: vitrine dos modais do WhatsApp (?wamodalspreview=1). Serve para
// conferir a linguagem visual (cabeçalho, campos, rodapé) sem precisar de uma
// conversa real — os modais reais só diferem no que fazem ao confirmar.
import React, { useState } from 'react';
import { ArrowRightLeft, Ban, CalendarClock, CheckCircle2, ShieldCheck } from 'lucide-react';
import {
  WaDialog, WaDialogBody, WaDialogActions, WaField, WaFieldStack,
  waInput, waTextarea, waSelect, waSelectStyle, waBtnGhost, waBtnPrimary, waBtnDanger,
} from '../components/whatsapp/ui';
import { TransferModal } from '../components/whatsapp/conversationModals';
import { RequestDocumentModal } from '../components/whatsapp/RequestDocumentModal';
import { QueuePanel } from '../components/whatsapp/queuePanel';
import { DEFAULT_QUEUE_POLICY, type QueuePolicy } from '../components/whatsapp/attendanceRouting';
import { scheduleFromRows, elapsedMinutesForChannels } from '../components/whatsapp/businessTime';
import { ToastProvider } from '../contexts/ToastContext';
import { WHATSAPP_MODULE_DEFAULTS } from '../services/settings.service';
import type { StaffOption } from '../services/whatsapp.service';
import type { WhatsAppConversation, WhatsAppDepartment } from '../types/whatsapp.types';

type Demo = 'transfer' | 'queue' | 'close' | 'block' | 'hold' | 'schedule' | 'documents';

// ── Cenário do modal de transferência ──
const conversa = (patch: Partial<WhatsAppConversation> & Pick<WhatsAppConversation, 'id'>): WhatsAppConversation => ({
  instance_id: 'canal-principal',
  remote_jid: `${patch.id}@s.whatsapp.net`,
  contact_phone: '5565984046375',
  contact_name: 'Isabel Maria',
  contact_avatar_path: null,
  contact_avatar_url: null,
  client_id: null,
  client_name: null,
  assigned_user_id: 'carla',
  department_id: null,
  status: 'open',
  unread_count: 0,
  last_message_at: '2026-08-04T13:40:00.000Z',
  last_message_preview: null,
  last_message_direction: 'in',
  presence: null,
  presence_updated_at: null,
  last_seen_at: null,
  is_blocked: false,
  blocked_at: null,
  blocked_by: null,
  blocked_reason: null,
  closed_at: null,
  closed_by: null,
  closure_reason: null,
  reopened_at: null,
  first_response_at: null,
  last_customer_message_at: '2026-08-04T13:40:00.000Z',
  last_agent_message_at: null,
  awaiting_accept: false,
  transfer_pending_since: null,
  contact_reason: null,
  labels: [],
  legal_hold: false,
  legal_hold_reason: null,
  absence_suppressed: false,
  created_at: '2026-08-04T12:00:00.000Z',
  updated_at: '2026-08-04T13:40:00.000Z',
  ...patch,
});

const DEMO_CONVERSATION = conversa({ id: 'conv-atual' });

// Fila de fundo: é dela que sai a carga mostrada ao lado de cada nome.
const DEMO_QUEUE: WhatsAppConversation[] = [
  DEMO_CONVERSATION,
  ...Array.from({ length: 5 }, (_, i) => conversa({ id: `ana-${i}`, assigned_user_id: 'dra-ana' })),
  ...Array.from({ length: 2 }, (_, i) => conversa({ id: `pedro-${i}`, assigned_user_id: 'dr-pedro' })),
  conversa({ id: 'ellen-0', assigned_user_id: 'ellen' }),
];

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

/** Fuso do escritório (Cuiabá, UTC-4) em minutos — o mesmo que a inbox usa. */
const OFFICE_OFFSET_MIN = -240;

/** Ontem, à hora cheia informada, no relógio do escritório. */
const ontemAsOfficeHour = (hour: number) => {
  const noEscritorio = new Date(Date.now() + OFFICE_OFFSET_MIN * 60_000);
  const utc = Date.UTC(
    noEscritorio.getUTCFullYear(), noEscritorio.getUTCMonth(), noEscritorio.getUTCDate() - 1, hour,
  );
  return new Date(utc - OFFICE_OFFSET_MIN * 60_000).toISOString();
};

// Fila com os quatro problemas que o painel existe para revelar.
const DEMO_QUEUE_TROUBLED: WhatsAppConversation[] = [
  conversa({
    id: 'travada-1', contact_name: 'Vicente da Costa', assigned_user_id: 'dr-pedro',
    awaiting_accept: true, transfer_pending_since: minutesAgo(84),
    last_message_direction: 'out', last_message_at: minutesAgo(84),
  }),
  conversa({
    id: 'travada-2', contact_name: 'Eliane Moraes', assigned_user_id: 'dra-ana',
    awaiting_accept: true, transfer_pending_since: minutesAgo(23),
    last_message_direction: 'out', last_message_at: minutesAgo(23),
  }),
  conversa({
    id: 'estourada', contact_name: 'Rafael Teixeira', assigned_user_id: null,
    last_customer_message_at: minutesAgo(190), last_message_at: minutesAgo(190),
  }),
  conversa({
    id: 'urgente', contact_name: 'Juliana Nogueira', assigned_user_id: null,
    labels: ['Urgente'], last_customer_message_at: minutesAgo(6), last_message_at: minutesAgo(6),
  }),
  conversa({
    id: 'atencao', contact_name: 'Douglas Almeida', assigned_user_id: null,
    last_customer_message_at: minutesAgo(28), last_message_at: minutesAgo(28),
  }),
  conversa({
    id: 'fila-setor', contact_name: 'Sandra Ribeiro', assigned_user_id: null,
    department_id: 'financeiro', last_message_direction: 'out', last_message_at: minutesAgo(52),
  }),
  ...Array.from({ length: 4 }, (_, i) => conversa({
    id: `ana-carga-${i}`, assigned_user_id: 'dra-ana', last_message_direction: 'out',
  })),
  conversa({ id: 'carla-1', assigned_user_id: 'carla', last_message_direction: 'out' }),
  // Duas conversas idênticas que chegaram ONTEM à noite, em canais com
  // expedientes diferentes. São elas que tornam visível o que o SLA em horário
  // útil faz: no relógio de parede as duas envelhecem a noite inteira; medidas
  // pelo expediente, só a do plantão 24h continua contando.
  conversa({
    id: 'ontem-comercial', contact_name: 'Marta Siqueira (canal comercial)',
    assigned_user_id: null, instance_id: 'canal-comercial',
    last_customer_message_at: ontemAsOfficeHour(19), last_message_at: ontemAsOfficeHour(19),
  }),
  conversa({
    id: 'ontem-plantao', contact_name: 'Otávio Lins (canal plantão)',
    assigned_user_id: null, instance_id: 'canal-plantao',
    last_customer_message_at: ontemAsOfficeHour(19), last_message_at: ontemAsOfficeHour(19),
  }),
];

// Expediente de cada canal do cenário: o comercial fecha às 18h, o plantão não
// fecha. Monta-se a partir das mesmas linhas que vêm de `whatsapp_business_hours`.
const AGENDAS_DEMO = {
  'canal-comercial': scheduleFromRows(
    [1, 2, 3, 4, 5].map(d => ({ day_of_week: d, start_time: '08:00', end_time: '18:00', is_active: true })),
    OFFICE_OFFSET_MIN,
  ),
  'canal-plantao': scheduleFromRows(
    [0, 1, 2, 3, 4, 5, 6].map(d => ({ day_of_week: d, start_time: '00:00', end_time: '23:59', is_active: true })),
    OFFICE_OFFSET_MIN,
  ),
};

const POLITICA_HORARIO_UTIL: QueuePolicy = {
  ...DEFAULT_QUEUE_POLICY,
  elapsedMinutes: elapsedMinutesForChannels(AGENDAS_DEMO, AGENDAS_DEMO['canal-comercial']),
};

const DEMO_DEPARTMENTS: WhatsAppDepartment[] = [
  { id: 'juridico', name: 'Previdenciário', color: null, is_active: true },
  { id: 'financeiro', name: 'Financeiro', color: null, is_active: true },
];

// Só a Ellen é do financeiro: é o que faz a conversa daquele setor cair nela e
// não em quem estiver mais livre.
const DEMO_DEPARTMENT_MEMBERS: Record<string, string[]> = {
  financeiro: ['ellen'],
  juridico: ['dra-ana', 'dr-pedro'],
};

const DEMO_STAFF: StaffOption[] = [
  { user_id: 'carla', name: 'Carla Menezes', role: 'Recepção', gender: 'female', oab: null },
  { user_id: 'ellen', name: 'Ellen Prado', role: 'Financeiro', gender: 'female', oab: null },
  { user_id: 'dra-ana', name: 'Ana Beatriz', role: 'Advogada', gender: 'female', oab: 'MT 12345' },
  { user_id: 'dr-pedro', name: 'Pedro Rodrigues', role: 'Advogado', gender: 'male', oab: 'MT 24680' },
];

const WhatsAppModalsPreview: React.FC = () => {
  // `?wamodalspreview=queue` abre direto o painel pedido — sem isso, conferir um
  // modal específico exige fechar o primeiro a cada recarregamento.
  const [open, setOpen] = useState<Demo | null>(() => {
    const wanted = new URLSearchParams(window.location.search).get('wamodalspreview');
    const known: Demo[] = ['transfer', 'queue', 'close', 'block', 'hold', 'schedule', 'documents'];
    return known.includes(wanted as Demo) ? (wanted as Demo) : 'transfer';
  });

  // Liga a medição em horário útil na fila. Fica desligado por padrão para o
  // cenário de problemas continuar sendo o que a vitrine mostra de saída.
  const [horarioUtil, setHorarioUtil] = useState(false);

  const botoes: { id: Demo; label: string }[] = [
    { id: 'transfer', label: 'Transferir conversa' },
    { id: 'queue', label: 'Fila de atendimento' },
    { id: 'close', label: 'Encerrar atendimento' },
    { id: 'block', label: 'Bloquear contato' },
    { id: 'hold', label: 'Guarda jurídica' },
    { id: 'schedule', label: 'Agendar mensagem' },
    { id: 'documents', label: 'Solicitar documento' },
  ];

  return (
    // O TransferModal real avisa por toast quando o envio falha — sem Provider
    // ele nem monta.
    <ToastProvider>
    <main className="min-h-screen bg-[#f5f5f3] p-6 sm:p-10">
      <div className="mx-auto max-w-2xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">WhatsApp · UI</p>
        <h1 className="text-lg font-semibold text-slate-900">Modais do atendimento</h1>
        <p className="mb-5 text-xs text-slate-500">Clique para abrir cada um e conferir cabeçalho, campos e rodapé.</p>
        <div className="flex flex-wrap gap-2">
          {botoes.map(b => (
            <button key={b.id} onClick={() => setOpen(b.id)} className={waBtnGhost}>{b.label}</button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={horarioUtil} onChange={e => setHorarioUtil(e.target.checked)} />
          Medir a fila em horário útil (comercial 8h–18h · plantão 24h)
        </label>
      </div>

      {/* Este é o componente REAL, não uma cópia: carga por atendente, sugestão
          de advogado e as travas de destino aparecem aqui exatamente como o
          atendente vê. Uma cópia decorativa envelheceria em uma semana. */}
      {open === 'transfer' && (
        <TransferModal
          conversation={DEMO_CONVERSATION}
          departments={DEMO_DEPARTMENTS}
          staff={DEMO_STAFF}
          moduleConfig={WHATSAPP_MODULE_DEFAULTS}
          conversations={DEMO_QUEUE}
          currentUserId="carla"
          previousAgentIds={['dr-pedro']}
          onClose={() => setOpen(null)}
          onDone={() => setOpen(null)}
        />
      )}

      {open === 'documents' && (
        <RequestDocumentModal
          conversationId="conversa-preview"
          clientId="cliente-preview"
          clientName="Pedro"
          createdBy={null}
          moduleConfig={WHATSAPP_MODULE_DEFAULTS}
          onClose={() => setOpen(null)}
        />
      )}

      {/* Fila com problemas de propósito: transferência que ninguém aceitou,
          SLA estourado e conversas sem dono. É o estado que precisa ser
          reconhecível de relance — a fila saudável não ensina nada. */}
      {open === 'queue' && (
        <QueuePanel
          conversations={DEMO_QUEUE_TROUBLED}
          staff={DEMO_STAFF}
          departmentMembers={DEMO_DEPARTMENT_MEMBERS}
          capacity={6}
          currentUserId="carla"
          policy={horarioUtil ? POLITICA_HORARIO_UTIL : DEFAULT_QUEUE_POLICY}
          onOpenConversation={() => {}}
          onChanged={() => {}}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'close' && (
        <WaDialog title="Encerrar atendimento" subtitle="itamar" icon={<CheckCircle2 size={18} />} tone="success"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><CheckCircle2 size={14} /> Encerrar</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
              A conversa sai da fila ativa e reabre sozinha se o cliente voltar a falar.
            </p>
            <WaFieldStack>
              <WaField label="Motivo do encerramento" optional="(interno, opcional)">
                <textarea rows={2} placeholder="Ex: dúvida resolvida" className={waTextarea} />
              </WaField>
              <WaField label="Mensagem ao cliente" optional="(deixe vazio para não enviar)"
                hint="Enviada no WhatsApp antes de encerrar.">
                <textarea rows={2} defaultValue="Foi um prazer atender você! Qualquer dúvida, é só chamar." className={waTextarea} />
              </WaField>
            </WaFieldStack>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'block' && (
        <WaDialog title="Bloquear contato" subtitle="+55 (66) 9609-8800" icon={<Ban size={18} />} tone="danger"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnDanger}><Ban size={14} /> Bloquear</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-red-100 bg-red-50/70 px-3 py-2.5 text-[12.5px] leading-relaxed text-red-800">
              O contato sai da fila normal de atendimento. A ação fica registrada.
            </p>
            <WaField label="Motivo do bloqueio" optional="(obrigatório)">
              <textarea rows={3} placeholder="Ex: spam, número trote, contato indevido" className={waTextarea} />
            </WaField>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'hold' && (
        <WaDialog title="Ativar guarda jurídica" subtitle="Robiane Aguiar" icon={<ShieldCheck size={18} />} tone="info"
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><ShieldCheck size={14} /> Ativar guarda</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <p className="mb-4 rounded-xl border border-[#eae7df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-600">
              A conversa fica protegida da política de retenção (não é purgada). Você pode registrar um motivo.
            </p>
            <WaField label="Motivo da guarda jurídica" optional="(opcional, interno)">
              <textarea rows={3} placeholder="Ex: processo em andamento, ordem judicial" className={waTextarea} />
            </WaField>
          </WaDialogBody>
        </WaDialog>
      )}

      {open === 'schedule' && (
        <WaDialog title="Agendar mensagem" icon={<CalendarClock size={18} />}
          onClose={() => setOpen(null)} size="sm"
          footer={
            <WaDialogActions>
              <button onClick={() => setOpen(null)} className={waBtnGhost}>Cancelar</button>
              <button className={waBtnPrimary}><CalendarClock size={14} /> Agendar</button>
            </WaDialogActions>
          }>
          <WaDialogBody>
            <WaFieldStack>
              <WaField label="Mensagem">
                <textarea rows={3} placeholder="Texto a enviar…" className={waTextarea} />
              </WaField>
              <WaField label="Data e hora" hint="Precisa ser pelo menos 1 minuto no futuro.">
                <input type="datetime-local" className={waInput} />
              </WaField>
            </WaFieldStack>
          </WaDialogBody>
        </WaDialog>
      )}
    </main>
    </ToastProvider>
  );
};

export default WhatsAppModalsPreview;
