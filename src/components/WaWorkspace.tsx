/**
 * WaWorkspace — sistema de workspace modal do WhatsApp 360.
 * Permite criar, editar e visualizar entidades do CRM sem sair da conversa.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Scale, FileText, Calendar, DollarSign,
  Clock, User as UserIcon, Check, Search, Copy, ExternalLink, Pencil,
  ShieldCheck, AlertTriangle, HelpCircle, ChevronRight, Phone, Trash2,
} from 'lucide-react';
import { processService } from '../services/process.service';
import { requirementService } from '../services/requirement.service';
import { financialService } from '../services/financial.service';
import { calendarService } from '../services/calendar.service';
import { documentTemplateService } from '../services/documentTemplate.service';
import { templateFillPermalinkService } from '../services/templateFillPermalink.service';
import { clientService } from '../services/client.service';
import { deadlineService } from '../services/deadline.service';
import ClientForm from './ClientForm';
import { ProcessTimeline } from './ProcessTimeline';
import { DeadlineFormModal } from './DeadlineFormModal';
import { AgreementFormModal } from './AgreementFormModal';
import { FinancialModal } from './FinancialModal';
import { ProcessFormModal } from './ProcessFormModal';
import { RequirementFormModal } from './RequirementFormModal';
import { EventFormModal } from './EventFormModal';
import { useAuth } from '../contexts/AuthContext';
import { useToastContext } from '../contexts/ToastContext';
import type { Process, ProcessStatus, ProcessPracticeArea } from '../types/process.types';
import type { Requirement, BenefitType } from '../types/requirement.types';
import type { Client, CreateClientDTO } from '../types/client.types';
import type { Deadline } from '../types/deadline.types';
import type { CalendarEvent } from '../types/calendar.types';
import type { DocumentTemplate } from '../types/document.types';
import { supabase } from '../config/supabase';

// ─── Tipos de modal ───────────────────────────────────────────────────────────

export type WaModal =
  | { type: 'client_view'; clientId: string }
  | { type: 'client_edit'; clientId: string }
  | { type: 'client_create'; prefill?: Partial<CreateClientDTO> }
  | { type: 'case_process_create'; clientId: string; clientName?: string }
  | { type: 'case_process_edit'; processId: string; clientId: string }
  | { type: 'case_requirement_create'; clientId: string; clientName?: string }
  | { type: 'case_requirement_edit'; requirementId: string }
  | { type: 'timeline_process'; processId: string; processCode: string; clientName?: string }
  | { type: 'deadline_create'; clientId: string; processId?: string; requirementId?: string }
  | { type: 'deadline_edit'; deadlineId: string; clientId: string }
  | { type: 'calendar_create'; clientId: string; processId?: string }
  | { type: 'calendar_view'; eventId: string }
  | { type: 'calendar_edit'; eventId: string }
  | { type: 'financial_create'; clientId: string; clientName?: string; processId?: string }
  | { type: 'financial_view'; agreementId: string }
  | { type: 'document_generate'; clientId: string; clientName?: string; processCode?: string }
  | { type: 'signature_create'; clientId: string };

// ─── Utilitários ─────────────────────────────────────────────────────────────

const inp = 'w-full px-3 py-2 text-[13px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none';
const lbl = 'block text-[11.5px] font-semibold text-slate-500 mb-1';

const PROC_STATUS: { key: ProcessStatus; label: string }[] = [
  { key: 'nao_protocolado', label: 'Não Protocolado' },
  { key: 'distribuido', label: 'Distribuído' },
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção' },
  { key: 'citacao', label: 'Citação' },
  { key: 'conciliacao', label: 'Conciliação' },
  { key: 'contestacao', label: 'Contestação' },
  { key: 'instrucao', label: 'Instrução' },
  { key: 'andamento', label: 'Em Andamento' },
  { key: 'sentenca', label: 'Sentença' },
  { key: 'recurso', label: 'Recurso' },
  { key: 'cumprimento', label: 'Cumprimento' },
  { key: 'arquivado', label: 'Arquivado' },
];

const PROC_AREA: { key: ProcessPracticeArea; label: string }[] = [
  { key: 'trabalhista', label: 'Trabalhista' },
  { key: 'familia', label: 'Família' },
  { key: 'consumidor', label: 'Consumidor' },
  { key: 'previdenciario', label: 'Previdenciário' },
  { key: 'civel', label: 'Cível' },
];

const REQ_STATUS: { key: Requirement['status']; label: string }[] = [
  { key: 'aguardando_confeccao', label: 'Aguardando Confecção' },
  { key: 'em_analise', label: 'Em Análise' },
  { key: 'em_exigencia', label: 'Em Exigência' },
  { key: 'aguardando_pericia', label: 'Aguardando Perícia' },
  { key: 'deferido', label: 'Deferido' },
  { key: 'indeferido', label: 'Indeferido' },
  { key: 'ajuizado', label: 'Ajuizado' },
];

const BENEFIT_TYPES: { key: BenefitType; label: string }[] = [
  { key: 'aposentadoria_tempo', label: 'Apos. por Tempo de Contribuição' },
  { key: 'aposentadoria_idade', label: 'Apos. por Idade' },
  { key: 'aposentadoria_invalidez', label: 'Apos. por Invalidez' },
  { key: 'auxilio_doenca', label: 'Auxílio-Doença' },
  { key: 'auxilio_acidente', label: 'Auxílio-Acidente' },
  { key: 'pensao_morte', label: 'Pensão por Morte' },
  { key: 'bpc_loas', label: 'BPC/LOAS' },
  { key: 'bpc_loas_deficiencia', label: 'BPC/LOAS Deficiência' },
  { key: 'bpc_loas_idoso', label: 'BPC/LOAS Idoso' },
  { key: 'salario_maternidade', label: 'Salário-Maternidade' },
  { key: 'outro', label: 'Outro' },
];

// ─── Base overlay ─────────────────────────────────────────────────────────────

const WaOverlay: React.FC<{
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  size?: 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, onClose, size = 'lg', footer, children }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const maxW = size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-xl';

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className={`${maxW} w-full max-h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#e7e5df] flex-shrink-0">
          {icon && <span className="text-amber-600">{icon}</span>}
          <h3 className="text-[15px] font-bold text-slate-800 flex-1 truncate">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex-shrink-0 px-5 py-4 border-t border-[#f1f0ec] flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

const BtnCancel: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} className="px-3 py-2 text-[13px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
);

const BtnSave: React.FC<{ saving: boolean; disabled?: boolean; onClick: () => void; label?: string }> = ({ saving, disabled, onClick, label = 'Salvar' }) => (
  <button onClick={onClick} disabled={saving || disabled}
    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700 disabled:opacity-50">
    {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {label}
  </button>
);

// ─── Modal: Cliente (ver/criar/editar) ────────────────────────────────────────

const WaClientModal: React.FC<{
  mode: 'view' | 'edit' | 'create';
  clientId?: string;
  prefill?: Partial<CreateClientDTO>;
  onClose: () => void;
  onSaved: (client: Client) => void;
}> = ({ mode, clientId, prefill, onClose, onSaved }) => {
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(mode !== 'create' && !!clientId);

  useEffect(() => {
    if (!clientId || mode === 'create') return;
    clientService.getClientById(clientId)
      .then(c => setClient(c))
      .finally(() => setLoading(false));
  }, [clientId, mode]);

  const title = mode === 'create' ? 'Novo cliente' : mode === 'edit' ? 'Editar cliente' : 'Dados do cliente';

  if (loading) {
    return (
      <WaOverlay title={title} icon={<UserIcon size={18} />} onClose={onClose}>
        <div className="flex items-center justify-center py-10 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Carregando…
        </div>
      </WaOverlay>
    );
  }

  if (mode === 'view' && client) {
    const fmtDoc = (doc: string | null) => {
      if (!doc) return '';
      const d = doc.replace(/\D/g, '');
      if (d.length === 11) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
      if (d.length === 14) return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
      return doc;
    };
    const row = (label: string, value: string | null | undefined) => value ? (
      <div key={label} className="grid grid-cols-3 gap-2 py-2 border-b border-[#f1f0ec] last:border-0">
        <span className="text-[11.5px] font-semibold text-slate-400 uppercase tracking-wide">{label}</span>
        <span className="col-span-2 text-[13px] text-slate-700">{value}</span>
      </div>
    ) : null;

    return (
      <WaOverlay title="Dados do cliente" icon={<UserIcon size={18} />} onClose={onClose} size="lg">
        <div className="space-y-0">
          {row('Nome', client.full_name)}
          {row('CPF/CNPJ', fmtDoc(client.cpf_cnpj ?? null))}
          {row('E-mail', client.email)}
          {row('Celular', client.mobile)}
          {row('Telefone', client.phone)}
          {row('Nascimento', client.birth_date ? new Date(client.birth_date).toLocaleDateString('pt-BR') : null)}
          {row('Profissão', client.profession)}
          {row('Estado civil', client.marital_status)}
          {row('Tipo', client.client_type === 'pessoa_fisica' ? 'Pessoa física' : client.client_type === 'pessoa_juridica' ? 'Pessoa jurídica' : client.client_type)}
          {row('Cidade', client.address_city)}
          {row('Estado', client.address_state)}
          {row('CEP', client.address_zip_code)}
          {row('Endereço', [client.address_street, client.address_number, client.address_complement, client.address_neighborhood].filter(Boolean).join(', '))}
          {client.notes && (
            <div className="py-2">
              <p className="text-[11.5px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Observações</p>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{client.notes}</p>
            </div>
          )}
        </div>
      </WaOverlay>
    );
  }

  return (
    <WaOverlay title={title} icon={<UserIcon size={18} />} onClose={onClose} size="xl">
      <ClientForm
        client={mode === 'edit' ? client : null}
        prefill={mode === 'create' ? prefill : undefined}
        onBack={onClose}
        onSave={saved => { onSaved(saved); onClose(); }}
        variant="modal"
      />
    </WaOverlay>
  );
};

// ─── Modal: Timeline de processo ──────────────────────────────────────────────

const WaTimelineModal: React.FC<{
  processId: string;
  processCode: string;
  clientName?: string;
  onClose: () => void;
}> = ({ processId, processCode, clientName, onClose }) =>
  // Portal para document.body: replica o padrão comprovado do ProcessesModule e
  // escapa de qualquer stacking context do shell do WhatsApp.
  createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10">
        <ProcessTimeline
          processCode={processCode}
          processId={processId}
          clientName={clientName}
          onClose={onClose}
        />
      </div>
    </div>,
    document.body,
  );

// ─── Modal: Detalhes do compromisso (visualização) ────────────────────────────

const WA_EVENT_TYPE_LABEL: Record<string, string> = {
  deadline: 'Prazo', hearing: 'Audiência', requirement: 'Requerimento',
  payment: 'Pagamento', meeting: 'Reunião', pericia: 'Perícia', personal: 'Pessoal',
};
const WA_EVENT_STATUS_LABEL: Record<string, string> = {
  pendente: 'Pendente', concluido: 'Concluído', cancelado: 'Cancelado',
};

type DjenInfo = {
  numero_processo: string | null; nome_orgao: string | null; sigla_tribunal: string | null;
  texto: string; data_disponibilizacao: string | null;
  datesFound: string[]; timesFound: string[]; detectedMode: 'online' | 'presencial' | null;
};

// Detalhes do compromisso (read-only) — espelha o modal da Agenda: chips de
// tipo/situação, data/hora, cliente (com ligar), processo/vara, modalidade e a
// Verificação DJEN para audiência/perícia. "Editar" alterna para o form real.
const WaEventViewModal: React.FC<{
  eventId: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ eventId, onClose, onSaved }) => {
  const toast = useToastContext();
  const [ev, setEv] = useState<CalendarEvent | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [process, setProcess] = useState<Process | null>(null);
  const [djen, setDjen] = useState<DjenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true); setClient(null); setProcess(null); setDjen(null);
    (async () => {
      const e = await calendarService.getEventById(eventId).catch(() => null);
      if (!alive) return;
      setEv(e);
      setLoading(false);
      if (!e) return;
      if (e.client_id) clientService.getClientById(e.client_id).then(c => { if (alive) setClient(c); }).catch(() => {});
      if (e.process_id) processService.getProcessById(e.process_id).then(p => { if (alive) setProcess(p); }).catch(() => {});
      // DJEN: intimação que confirmou/divergiu (audiência/perícia)
      if (e.djen_intimation_id) {
        const { data } = await supabase.from('djen_comunicacoes')
          .select('numero_processo, nome_orgao, sigla_tribunal, texto, data_disponibilizacao')
          .eq('id', e.djen_intimation_id).maybeSingle();
        if (!alive || !data) return;
        const texto = data.texto ?? '';
        const datesFound = [...new Set([...texto.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1]))];
        const timesFound = [...new Set([...texto.matchAll(/(\d{1,2})[h:](\d{2})(?:min)?(?:h)?/gi)].map(m => `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`))];
        const tl = texto.toLowerCase();
        const detectedMode: 'online' | 'presencial' | null =
          /videoconfer[eê]ncia|virtual|zoom|teams|online|teleaudiência|plataforma/.test(tl) ? 'online'
          : /presencial|in\s+loco/.test(tl) ? 'presencial' : null;
        setDjen({ numero_processo: data.numero_processo, nome_orgao: data.nome_orgao, sigla_tribunal: data.sigla_tribunal, texto, data_disponibilizacao: data.data_disponibilizacao, datesFound, timesFound, detectedMode });
      }
    })();
    return () => { alive = false; };
  }, [eventId]);

  if (editing) {
    return <EventFormModal open onClose={onClose} onSaved={onSaved} eventId={eventId} />;
  }

  const handleDelete = async () => {
    setBusy(true);
    try {
      await calendarService.deleteEvent(eventId);
      toast.success('Compromisso excluído.');
      onSaved(); onClose();
    } catch (e: any) { toast.error('Falha ao excluir', e?.message); setBusy(false); }
  };

  const fmtFull = (iso: string) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const phone = client?.mobile || client?.phone || null;
  const orgao = process?.court || djen?.nome_orgao || null;
  const isHearing = ev ? ['hearing', 'pericia'].includes(ev.event_type) : false;
  const djenStatus = ev?.djen_status ?? null;
  const eventDate = ev ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ev.start_at)) : null;
  const eventTime = ev ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' }).format(new Date(ev.start_at)) : null;

  const DjStatusIcon = djenStatus === 'confirmed' ? ShieldCheck : djenStatus === 'divergence' ? AlertTriangle : HelpCircle;
  const djIconColor = djenStatus === 'confirmed' ? 'text-green-600' : djenStatus === 'divergence' ? 'text-amber-500' : 'text-slate-400';
  const djBadge = djenStatus === 'confirmed' ? 'bg-green-100 text-green-700 ring-green-200' : djenStatus === 'divergence' ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-slate-100 text-slate-500 ring-slate-200';
  const djLabel = djenStatus === 'confirmed' ? 'Confirmado' : djenStatus === 'divergence' ? 'Divergência' : 'Não confirmado';

  const cell = (icon: React.ReactNode, label: string, value: React.ReactNode, extra?: React.ReactNode) => (
    <div className="flex items-start gap-2 min-w-0">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <div className="text-xs font-semibold text-slate-800 mt-0.5 truncate">{value}</div>
      </div>
      {extra}
    </div>
  );

  return (
    <WaOverlay
      title={ev?.title || 'Compromisso'}
      icon={<Calendar size={18} />}
      onClose={onClose}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          {confirmingDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-semibold text-red-600">Excluir mesmo?</span>
              <button onClick={handleDelete} disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-[11.5px] font-semibold hover:bg-red-700 disabled:opacity-50">
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Confirmar
              </button>
              <button onClick={() => setConfirmingDelete(false)} className="px-2 py-1.5 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Não</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingDelete(true)}
              className="px-3 py-1.5 text-[12px] font-semibold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition">
              Excluir
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={onClose} className="px-3 py-1.5 text-[12px] font-semibold text-slate-500 hover:text-slate-700">Fechar</button>
            <button onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12px] font-semibold hover:bg-amber-700">
              <Pencil size={13} /> Editar compromisso
            </button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={20} className="animate-spin mr-2" /> Carregando…</div>
      ) : !ev ? (
        <p className="text-[13px] text-slate-400 py-6 text-center">Compromisso não encontrado.</p>
      ) : (
        <div className="space-y-3">
          {/* Chips de tipo + situação */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200">
              {WA_EVENT_TYPE_LABEL[ev.event_type] || ev.event_type}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
              ev.status === 'concluido' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : ev.status === 'cancelado' ? 'bg-red-50 text-red-700 border-red-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
              {WA_EVENT_STATUS_LABEL[ev.status] || ev.status}
            </span>
          </div>

          {/* Resumo compacto */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              {cell(<Calendar className="w-3.5 h-3.5 text-amber-500" />, 'Data e hora', fmtFull(ev.start_at))}
              {ev.client_name && cell(
                <UserIcon className="w-3.5 h-3.5 text-violet-400" />, 'Cliente',
                <span className="text-amber-600">{ev.client_name}</span>,
                phone ? (
                  <a href={`tel:${phone}`} title="Ligar" className="w-6 h-6 flex items-center justify-center rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 transition shrink-0 mt-0.5">
                    <Phone className="w-3 h-3" />
                  </a>
                ) : undefined,
              )}
              {process && cell(<span className="w-1.5 h-1.5 rounded-full bg-blue-400 block mt-1.5" />, 'Processo',
                <span className="font-mono">{process.process_code}</span>)}
              {orgao && cell(<span className="w-1.5 h-1.5 rounded-full bg-slate-400 block mt-1.5" />, 'Vara / Tribunal', orgao)}
              {ev.event_mode && cell(<span className="text-sm leading-none">{ev.event_mode === 'online' ? '📹' : '📍'}</span>, 'Modalidade', ev.event_mode === 'online' ? 'Online' : 'Presencial')}
            </div>
          </div>

          {/* Verificação DJEN (audiência/perícia) */}
          {isHearing && (
            <div className={`rounded-xl border bg-[#f8f7f5] px-3 py-2.5 space-y-2 ${djenStatus === 'confirmed' ? 'border-green-100' : djenStatus === 'divergence' ? 'border-amber-100' : 'border-slate-100'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DjStatusIcon className={`w-3.5 h-3.5 shrink-0 ${djIconColor}`} />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Verificação DJEN</p>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${djBadge}`}>{djLabel}</span>
              </div>
              {eventDate && (
                <div className="rounded-lg overflow-hidden border border-slate-100">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="text-left px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide w-[26%]">Campo</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Agenda</th>
                        <th className="text-right px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide">DJEN</th>
                        <th className="w-8 px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      <tr>
                        <td className="px-2 py-1.5 text-slate-500">Data</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{eventDate}</td>
                        <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${djenStatus === 'confirmed' ? 'text-green-700' : djenStatus === 'divergence' ? 'text-amber-700' : 'text-slate-400'}`}>{djen?.datesFound[0] ?? '—'}</td>
                        <td className="px-2 py-1.5 text-center">{djenStatus === 'confirmed' ? <Check className="w-3.5 h-3.5 text-green-500 mx-auto" /> : djenStatus === 'divergence' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                      </tr>
                      {eventTime && (
                        <tr>
                          <td className="px-2 py-1.5 text-slate-500">Hora</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-slate-700 tabular-nums">{eventTime}</td>
                          <td className={`px-2 py-1.5 text-right font-semibold tabular-nums ${djen?.timesFound.length ? 'text-green-700' : 'text-slate-400'}`}>{djen?.timesFound.join(' / ') || '—'}</td>
                          <td className="px-2 py-1.5 text-center">{djen?.timesFound.length ? <Check className="w-3.5 h-3.5 text-green-500 mx-auto" /> : <span className="text-slate-300">—</span>}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {djen && (
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 px-1">
                  {djen.numero_processo && <span className="text-[10px] text-slate-400">Proc. <span className="font-semibold text-slate-600 tabular-nums">{djen.numero_processo}</span></span>}
                  {djen.sigla_tribunal && <span className="text-[10px] text-slate-400">{djen.sigla_tribunal}{djen.nome_orgao ? ` · ${djen.nome_orgao}` : ''}</span>}
                  {djen.data_disponibilizacao && <span className="text-[10px] text-slate-400">Pub. <span className="font-semibold text-slate-600">{new Intl.DateTimeFormat('pt-BR').format(new Date(djen.data_disponibilizacao))}</span></span>}
                </div>
              )}
              {djen?.texto && (
                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition select-none">
                    <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" /> Ver trecho da intimação
                  </summary>
                  <div className="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-50 border border-[#e7e5df] px-2.5 py-2">
                    <p className="text-[11px] text-slate-600 leading-relaxed">{djen.texto.slice(0, 800)}{djen.texto.length > 800 ? '…' : ''}</p>
                  </div>
                </details>
              )}
              {(!djenStatus || djenStatus === 'unconfirmed') && !djen && (
                <p className="text-[10px] text-slate-400 italic text-center py-0.5">Nenhuma intimação DJEN localizada para este evento.</p>
              )}
            </div>
          )}

          {/* Observações */}
          {ev.description && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Observações</p>
              <p className="text-[13px] text-slate-700 whitespace-pre-wrap">{ev.description}</p>
            </div>
          )}
        </div>
      )}
    </WaOverlay>
  );
};

// ─── Modal: Templates de documento (copiar link) ──────────────────────────────

const WaTemplateLinkModal: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const toast = useToastContext();
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const isRequirementsMsTemplate = (template: DocumentTemplate) => {
      const name = (template.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      const description = (template.description || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
      return name.startsWith('MODELO MS (REQUERIMENTOS)') || description.includes('[REQUERIMENTOS_MS]');
    };

    documentTemplateService.listTemplates()
      .then(async (allTemplates) => {
        const visibleTemplates = allTemplates.filter(t => !isRequirementsMsTemplate(t));
        const permalinkChecks = await Promise.all(
          visibleTemplates.map(async (template) => {
            try {
              const permalinks = await templateFillPermalinkService.listPermalinks(template.id);
              const activePermalink = permalinks.find((p: any) => p.is_active);
              return activePermalink ? template : null;
            } catch {
              return null;
            }
          }),
        );
        setTemplates(permalinkChecks.filter((t): t is DocumentTemplate => !!t));
      })
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = templates.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase())
  );

  // Link PÚBLICO de preenchimento/assinatura (/#/p/<slug>) — o cliente preenche e
  // assina pela página pública. Usa o permalink ativo do template (não o arquivo).
  const linkFor = async (t: DocumentTemplate) => {
    const permalinks = await templateFillPermalinkService.listPermalinks(t.id);
    const active = permalinks.find((p: any) => p.is_active) ?? permalinks[0];
    if (!active?.slug) {
      throw new Error('Este template não tem link de preenchimento. Crie um permalink no módulo Documentos.');
    }
    return `${window.location.origin}/#/p/${active.slug}`;
  };

  const copyLink = async (t: DocumentTemplate) => {
    setBusyId(t.id);
    try {
      const url = await linkFor(t);
      await navigator.clipboard.writeText(url);
      setCopiedId(t.id);
      toast.success('Link de preenchimento copiado.');
      setTimeout(() => setCopiedId(id => (id === t.id ? null : id)), 2000);
    } catch (e: any) {
      toast.error('Não foi possível gerar o link', e.message);
    } finally { setBusyId(null); }
  };

  const openLink = async (t: DocumentTemplate) => {
    setBusyId(t.id);
    try {
      const url = await linkFor(t);
      window.open(url, '_blank', 'noopener');
    } catch (e: any) {
      toast.error('Não foi possível abrir o template', e.message);
    } finally { setBusyId(null); }
  };

  return (
    <WaOverlay title="Link de preenchimento e assinatura" icon={<FileText size={18} />} onClose={onClose} size="lg">
      <div className="space-y-3">
        <p className="text-[12.5px] text-slate-500">Copie o link público (/#/p/…) para o cliente preencher e assinar o documento. O link exige um permalink configurado no módulo Documentos.</p>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            className={inp + ' pl-8'} placeholder="Buscar template…" />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Carregando templates…
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-[13px] text-slate-400">
            {search ? 'Nenhum template encontrado.' : 'Nenhum template com link público ativo. Configure um permalink no módulo de Documentos.'}
          </p>
        ) : (
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {filtered.map(t => {
              const busy = busyId === t.id;
              const copied = copiedId === t.id;
              return (
                <div key={t.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#e7e5df]">
                  <FileText size={18} className="text-slate-300 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-slate-700 truncate">{t.name}</p>
                    {t.description && <p className="text-[11.5px] text-slate-400 truncate">{t.description}</p>}
                  </div>
                  <button onClick={() => openLink(t)} disabled={busy} title="Abrir página de preenchimento em nova aba"
                    className="p-2 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition disabled:opacity-40">
                    <ExternalLink size={15} />
                  </button>
                  <button onClick={() => copyLink(t)} disabled={busy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 transition disabled:opacity-40">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copiado' : 'Copiar link'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </WaOverlay>
  );
};

// ─── Modal: Prazo (usando DeadlineFormModal) ──────────────────────────────────

const WaDeadlineModal: React.FC<{
  clientId: string;
  processId?: string;
  requirementId?: string;
  deadlineId?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ clientId, processId, requirementId, deadlineId, onClose, onSaved }) => {
  const [deadline, setDeadline] = useState<Deadline | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('*').then(r => r.data ?? []),
      processService.listProcesses(),
      clientService.listClients(),
      requirementService.listRequirements(),
      deadlineId
        ? supabase.from('deadlines').select('*').eq('id', deadlineId).single().then(r => r.data)
        : Promise.resolve(null),
    ]).then(([m, p, c, req, dl]) => {
      setMembers(m as any[]);
      setProcesses(p);
      setClients(c);
      setRequirements(req);
      if (dl) setDeadline(dl as Deadline);
    }).finally(() => setLoading(false));
  }, [deadlineId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
        <Loader2 size={24} className="animate-spin text-white" />
      </div>
    );
  }

  return (
    <DeadlineFormModal
      open
      onClose={onClose}
      onSaved={onSaved}
      selectedDeadline={deadline}
      initialData={{
        client_id: clientId,
        process_id: processId || '',
        requirement_id: requirementId || '',
      }}
      members={members}
      processes={processes}
      clients={clients}
      requirements={requirements}
    />
  );
};

// ─── Renderer principal ───────────────────────────────────────────────────────

export interface WaWorkspaceRendererProps {
  modal: WaModal | null;
  onClose: () => void;
  onSaved?: (type: string) => void;
}

export const WaWorkspaceRenderer: React.FC<WaWorkspaceRendererProps> = ({ modal, onClose, onSaved }) => {
  const done = useCallback((type: string) => { onSaved?.(type); onClose(); }, [onSaved, onClose]);

  if (!modal) return null;

  switch (modal.type) {
    case 'client_view':
      return <WaClientModal mode="view" clientId={modal.clientId} onClose={onClose} onSaved={() => done('client')} />;
    case 'client_edit':
      return <WaClientModal mode="edit" clientId={modal.clientId} onClose={onClose} onSaved={() => done('client')} />;
    case 'client_create':
      return <WaClientModal mode="create" prefill={modal.prefill} onClose={onClose} onSaved={() => done('client')} />;

    case 'case_process_create':
      return <ProcessFormModal open onClose={onClose} onSaved={() => done('process')} initialClientId={modal.clientId} initialClientName={modal.clientName} lockClient />;
    case 'case_process_edit':
      return <ProcessFormModal open onClose={onClose} onSaved={() => done('process')} initialClientId={modal.clientId} processId={modal.processId} lockClient />;

    case 'case_requirement_create':
      return <RequirementFormModal open onClose={onClose} onSaved={() => done('requirement')} initialClientId={modal.clientId} initialClientName={modal.clientName} />;
    case 'case_requirement_edit':
      return <RequirementFormModal open onClose={onClose} onSaved={() => done('requirement')} requirementId={modal.requirementId} />;

    case 'timeline_process':
      return <WaTimelineModal processId={modal.processId} processCode={modal.processCode} clientName={modal.clientName} onClose={onClose} />;

    case 'deadline_create':
      return <WaDeadlineModal clientId={modal.clientId} processId={modal.processId} requirementId={modal.requirementId} onClose={onClose} onSaved={() => done('deadline')} />;
    case 'deadline_edit':
      return <WaDeadlineModal clientId={modal.clientId} deadlineId={modal.deadlineId} onClose={onClose} onSaved={() => done('deadline')} />;

    case 'calendar_create':
      return <EventFormModal open onClose={onClose} onSaved={() => done('calendar')} initialClientId={modal.clientId} initialProcessId={modal.processId} lockClient={!!modal.clientId} />;
    case 'calendar_view':
      return <WaEventViewModal eventId={modal.eventId} onClose={onClose} onSaved={() => done('calendar')} />;
    case 'calendar_edit':
      return <EventFormModal open onClose={onClose} onSaved={() => done('calendar')} eventId={modal.eventId} />;

    case 'financial_create':
      return (
        <AgreementFormModal
          open
          onClose={onClose}
          onSaved={() => done('financial')}
          initialClientId={modal.clientId}
          initialClientName={modal.clientName}
          initialProcessId={modal.processId}
          lockClient
        />
      );

    case 'financial_view':
      return <FinancialModal agreementId={modal.agreementId} onClose={onClose} />;

    case 'document_generate':
      return <WaTemplateLinkModal onClose={onClose} />;

    case 'signature_create':
      return null;

    default:
      return null;
  }
};
