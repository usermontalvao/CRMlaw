// Adaptadores do WhatsApp para os formulários oficiais dos módulos de Prazos e Tarefas.
import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';
import { DeadlineFormModal } from '../DeadlineFormModal';
import { TaskFormModal } from '../TaskFormModal';
import { Modal, ModalBody } from '../ui';
import { msgDescription, msgTitle } from './format';
import { processService } from '../../services/process.service';
import { requirementService } from '../../services/requirement.service';
import {
  DEADLINE_MODULE_DEFAULTS,
  settingsService,
  type DeadlineModuleConfig,
} from '../../services/settings.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { DeadlinePriority, DeadlineStatus, DeadlineType } from '../../types/deadline.types';
import type { Client } from '../../types/client.types';
import type { Process } from '../../types/process.types';
import type { Requirement } from '../../types/requirement.types';
import type { WhatsAppMessage } from '../../types/whatsapp.types';
import type { Profile } from '../../services/profile.service';

const EMPTY_CLIENTS: Client[] = [];

type FromMessageProps = {
  message: WhatsAppMessage;
  clientId: string;
  clientName: string;
  processes: Process[];
  onClose: () => void;
};

type DeadlineResources = {
  members: Profile[];
  processes: Process[];
  requirements: Requirement[];
  config: DeadlineModuleConfig;
};

const DEFAULT_RESOURCES: DeadlineResources = {
  members: [],
  processes: [],
  requirements: [],
  config: DEADLINE_MODULE_DEFAULTS,
};

export const CreateDeadlineFromMessageModal: React.FC<FromMessageProps> = ({
  message,
  clientId,
  clientName,
  processes,
  onClose,
}) => {
  const toast = useToastContext();
  const [resources, setResources] = useState<DeadlineResources>(DEFAULT_RESOURCES);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const processKey = processes.map(process => process.id).join('|');
  const stableProcesses = useMemo(() => processes, [processKey]);

  const initialData = useMemo(() => ({
    title: msgTitle(message),
    description: msgDescription(message),
    client_id: clientId,
    type: (stableProcesses.length > 0 ? 'processo' : 'geral') as DeadlineType,
    process_id: stableProcesses.length === 1 ? stableProcesses[0].id : '',
  }), [clientId, message.content, message.id, message.type, message.wa_timestamp, stableProcesses]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      settingsService.listUsers(),
      processService.listProcesses(),
      requirementService.listRequirements(),
      settingsService.getDeadlineModuleConfig(),
    ]).then(([members, allProcesses, requirements, config]) => {
      if (!active) return;
      setResources({ members, processes: allProcesses, requirements, config });
    }).catch((error: any) => {
      if (!active) return;
      setLoadError(error?.message || 'Não foi possível carregar o formulário de prazo.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [clientId, loadAttempt]);

  const deadlineOptions = useMemo(() => ({
    statuses: resources.config.statuses
      .filter(option => option.active !== false)
      .map(option => ({ key: option.key as DeadlineStatus, label: option.label })),
    priorities: resources.config.priorities
      .filter(option => option.active !== false)
      .map(option => ({ key: option.key as DeadlinePriority, label: option.label })),
    types: resources.config.types
      .filter(option => option.active !== false)
      .map(option => ({ key: option.key as DeadlineType, label: option.label })),
  }), [resources.config]);

  if (loading || loadError) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Novo Prazo"
        subtitle={loading ? 'Carregando o formulário do módulo de Prazos' : 'Não foi possível carregar o formulário'}
        icon={<Clock className="h-5 w-5" />}
        size="2xl"
        zIndex={80}
      >
        <ModalBody className="px-5 py-10">
          {loading ? (
            <div className="flex items-center justify-center gap-3 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
              Carregando responsáveis e configurações…
            </div>
          ) : (
            <div className="mx-auto max-w-md text-center">
              <p className="text-sm text-red-600">{loadError}</p>
              <button type="button" onClick={() => setLoadAttempt(attempt => attempt + 1)} className="mt-4 rounded bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600">
                Tentar novamente
              </button>
            </div>
          )}
        </ModalBody>
      </Modal>
    );
  }

  return (
    <DeadlineFormModal
      open
      onClose={onClose}
      onSaved={() => {
        toast.success('Prazo criado.');
        onClose();
      }}
      initialData={initialData}
      initialClientName={clientName}
      source="manual"
      members={resources.members}
      processes={resources.processes}
      clients={EMPTY_CLIENTS}
      requirements={resources.requirements}
      statusOptions={deadlineOptions.statuses}
      priorityOptions={deadlineOptions.priorities}
      typeOptions={deadlineOptions.types}
    />
  );
};

export const CreateTaskFromMessageModal: React.FC<FromMessageProps> = ({
  message,
  clientId,
  clientName,
  onClose,
}) => {
  const toast = useToastContext();
  const initialData = useMemo(() => ({
    title: msgTitle(message),
    client_id: clientId,
  }), [clientId, message.content, message.id, message.type]);

  return (
    <TaskFormModal
      open
      onClose={onClose}
      onSaved={() => {
        toast.success('Tarefa criada.');
        onClose();
      }}
      initialData={initialData}
      initialClientName={clientName}
      variant="quick"
    />
  );
};
