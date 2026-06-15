/**
 * WaWorkspace — sistema de workspace modal do WhatsApp 360.
 * Permite criar, editar e visualizar entidades do CRM sem sair da conversa.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Scale, FileText, Calendar, DollarSign,
  Clock, User as UserIcon, Check, Search, Copy, ExternalLink,
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
