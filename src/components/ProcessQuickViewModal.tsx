import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BriefcaseBusiness,
  Calendar,
  Check,
  Clock,
  Copy,
  Edit2,
  ExternalLink,
  FileText,
  Gavel,
  Loader2,
  MapPin,
  RefreshCw,
  Scale,
  User,
} from 'lucide-react';
import { Modal, ModalBody } from './ui';
import { ProcessFormModal } from './ProcessFormModal';
import { processService } from '../services/process.service';
import { clientService } from '../services/client.service';
import { processTimelineService, type TimelineEvent } from '../services/processTimeline.service';
import type { Process, ProcessStatus } from '../types/process.types';
import type { Client } from '../types/client.types';
import { LAYER } from '../styles/layers';

interface ProcessQuickViewModalProps {
  processId: string | null;
  onClose: () => void;
  onOpenModule?: (processId: string) => void;
  onProcessUpdated?: (process: Process) => void;
}

const STATUS_LABELS: Record<ProcessStatus, string> = {
  nao_protocolado: 'Não protocolado',
  distribuido: 'Distribuído',
  aguardando_confeccao: 'Aguardando confecção',
  citacao: 'Citação',
  conciliacao: 'Conciliação',
  contestacao: 'Contestação',
  instrucao: 'Instrução',
  andamento: 'Em andamento',
  sentenca: 'Sentença',
  recurso: 'Recurso',
  cumprimento: 'Cumprimento',
  arquivado: 'Arquivado',
};

const AREA_LABELS: Record<Process['practice_area'], string> = {
  trabalhista: 'Trabalhista',
  familia: 'Família',
  consumidor: 'Consumidor',
  previdenciario: 'Previdenciário',
  civel: 'Cível',
};

const formatDate = (value?: string | null, withTime = false) => {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', withTime
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { dateStyle: 'short' }).format(date);
};

export const ProcessQuickViewModal: React.FC<ProcessQuickViewModalProps> = ({
  processId,
  onClose,
  onOpenModule,
  onProcessUpdated,
}) => {
  const [process, setProcess] = useState<Process | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    if (!processId) return;
    setLoading(true);
    setError(null);
    try {
      const loadedProcess = await processService.getProcessById(processId);
      if (!loadedProcess) throw new Error('Processo não encontrado.');
      setProcess(loadedProcess);

      const [loadedClient, loadedTimeline] = await Promise.all([
        loadedProcess.client_id
          ? clientService.getClientById(loadedProcess.client_id).catch(() => null)
          : Promise.resolve(null),
        loadedProcess.process_code
          ? processTimelineService.fetchProcessTimeline(loadedProcess.process_code).catch(() => [])
          : Promise.resolve([]),
      ]);
      setClient(loadedClient);
      setTimeline(loadedTimeline.slice(0, 5));
      onProcessUpdated?.(loadedProcess);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Não foi possível carregar o processo.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setProcess(null);
    setClient(null);
    setTimeline([]);
    if (processId) void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processId]);

  const copyProcessNumber = async () => {
    if (!process?.process_code) return;
    await navigator.clipboard.writeText(process.process_code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <Modal
        open={!!processId && !editing}
        onClose={onClose}
        title={process?.process_code || 'Detalhes do processo'}
        eyebrow="Processo vinculado à intimação"
        icon={<Scale className="w-5 h-5" />}
        size="xl"
        zIndex={LAYER.MODAL_NESTED}
        headerActions={process ? (
          <button
            type="button"
            onClick={copyProcessNumber}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Copiar número do processo"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
          </button>
        ) : undefined}
        footer={process ? (
          <div className="flex w-full flex-wrap justify-between gap-2">
            <button
              type="button"
              onClick={() => onOpenModule?.(process.id)}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Abrir módulo completo
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition"
            >
              <Edit2 className="w-4 h-4" /> Editar processo
            </button>
          </div>
        ) : undefined}
      >
        <ModalBody className="p-0">
          {loading ? (
            <div className="min-h-[360px] flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-7 h-7 animate-spin text-orange-500" />
              <span className="text-sm">Carregando processo…</span>
            </div>
          ) : error ? (
            <div className="min-h-[320px] flex flex-col items-center justify-center gap-3 p-8 text-center">
              <AlertCircle className="w-9 h-9 text-red-500" />
              <p className="text-sm font-semibold text-slate-800">{error}</p>
              <button onClick={() => void load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-sm font-medium">
                <RefreshCw className="w-4 h-4" /> Tentar novamente
              </button>
            </div>
          ) : process ? (
            <div className="bg-white">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center gap-3">
                <div className="min-w-0 mr-auto">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cliente</div>
                  <div className="font-semibold text-slate-900 truncate">{client?.full_name || 'Cliente não encontrado'}</div>
                </div>
                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-bold uppercase tracking-wide">
                  {STATUS_LABELS[process.status]}
                </span>
                {process.priority === 'urgente' && (
                  <span className="px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-[10px] font-bold uppercase">Urgente</span>
                )}
                {process.djen_has_data && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold uppercase">DJEN sincronizado</span>
                )}
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 rounded-xl border border-slate-200 overflow-hidden">
                  {[
                    { icon: User, label: 'Responsável', value: process.responsible_lawyer || 'Não informado' },
                    { icon: BriefcaseBusiness, label: 'Área', value: AREA_LABELS[process.practice_area] },
                    { icon: Calendar, label: 'Distribuição', value: formatDate(process.distributed_at) },
                    { icon: MapPin, label: 'Vara / comarca', value: process.court || 'Não informado' },
                    {
                      icon: Gavel,
                      label: 'Audiência',
                      value: process.hearing_scheduled
                        ? `${formatDate(process.hearing_date)}${process.hearing_time ? ` · ${process.hearing_time.slice(0, 5)}` : ''}`
                        : 'Não agendada',
                    },
                    { icon: Clock, label: 'Última atualização', value: formatDate(process.updated_at, true) },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="p-4 border-b border-r border-slate-100 last:border-r-0">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">
                        <Icon className="w-3 h-3" /> {label}
                      </div>
                      <div className="text-sm font-medium text-slate-800">{value}</div>
                    </div>
                  ))}
                </div>

                {process.execution_pending && !process.execution_resolved_at && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-bold text-amber-900">Avaliar cumprimento de sentença / execução</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-700">O processo foi identificado como procedente e arquivado, com pendência de execução.</p>
                  </div>
                )}

                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <FileText className="w-4 h-4 text-orange-500" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-600">Movimentações recentes</h3>
                  </div>
                  {timeline.length > 0 ? (
                    <div className="space-y-2">
                      {timeline.map((event) => (
                        <div key={event.id} className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                          <span className="mt-1.5 w-2 h-2 rounded-full bg-orange-400 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{event.title}</span>
                              <span className="text-[10px] text-slate-400">{formatDate(event.date)}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{event.description || event.orgao}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">
                      Nenhuma movimentação sincronizada.
                    </div>
                  )}
                </section>
              </div>
            </div>
          ) : null}
        </ModalBody>
      </Modal>

      {process && (
        <ProcessFormModal
          open={editing}
          processId={process.id}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </>
  );
};

export default ProcessQuickViewModal;
