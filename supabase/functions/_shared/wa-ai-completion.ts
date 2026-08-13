/** Encerramento determinístico dos roteiros nativos de WhatsApp. */

export interface WaAiCompletionActionRef {
  action: string;
  target_type: 'user' | 'department' | 'document_template' | 'none';
  target_id: string | null;
  target_label: string;
  raw: string;
}

export interface WaAiCompletionAssistant {
  allowed_actions: string[];
  action_refs: WaAiCompletionActionRef[];
}

export interface WaAiCompletionPlaybook {
  id: string;
  bindings?: {
    key: string;
    action: string;
    targetLabel?: string;
    suggestedTargetLabel?: string;
  }[];
}

export interface WaAiCompletionMemory {
  knownFacts: Record<string, string | number | boolean>;
  pendingItems: string[];
}

export interface WaAiCompletionExternalState {
  documents: 'none' | 'pending' | 'complete';
  kit: 'none' | 'pending' | 'signed' | 'refused';
}

export type WaAiCompletionPlan = {
  action: 'solicitar_documentos' | 'enviar_documento'
    | 'transferir_atendimento' | 'transferir_para_humano';
  args: Record<string, unknown>;
  ref: WaAiCompletionActionRef | null;
};

function comparable(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function completionSummary(memory: WaAiCompletionMemory) {
  const facts = Object.entries(memory.knownFacts)
    .map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
  const pending = memory.pendingItems.join(' · ');
  return [
    'Motivo: Triagem concluída com os critérios mínimos confirmados.',
    facts ? `Fatos informados: ${facts}.` : 'Ainda não há fatos estruturados.',
    pending ? `Informações faltantes: ${pending}.` : 'Sem pendências do roteiro.',
  ].join(' ').slice(0, 800);
}

function bindingRef(
  assistant: WaAiCompletionAssistant, playbook: WaAiCompletionPlaybook,
  key: string, action: string,
) {
  const binding = (playbook.bindings || []).find(item => item.key === key);
  const label = String(binding?.targetLabel || binding?.suggestedTargetLabel || '').trim();
  if (binding?.action !== action || !label) return null;
  return assistant.action_refs.find(item => item.action === action
    && comparable(item.target_label) === comparable(label) && !!item.target_id) || null;
}

function accountDocuments(memory: WaAiCompletionMemory) {
  const route = String(memory.knownFacts.residencia_tipo || '');
  const documents = [
    'Documento de identificação com foto do cliente',
    'Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta',
  ];
  if (route === 'aluguel_com_contrato') documents.push('Contrato de aluguel');
  else if (route === 'terceiro_sem_contrato') documents.push('Documento de identificação com foto do declarante');
  else documents.push('Comprovante de residência em nome próprio ou de esposa, esposo, pai ou mãe');
  return documents;
}

function buildAccountCompletionPlans(
  assistant: WaAiCompletionAssistant, playbook: WaAiCompletionPlaybook,
  memory: WaAiCompletionMemory, state: WaAiCompletionExternalState,
): WaAiCompletionPlan[] {
  const allowed = new Set(assistant.allowed_actions || []);
  if (state.documents === 'none') {
    return allowed.has('solicitar_documentos') ? [{
      action: 'solicitar_documentos',
      args: {
        titulo: 'Documentos essenciais — conta bloqueada ou encerrada',
        documentos: accountDocuments(memory),
      },
      ref: null,
    }] : [];
  }
  if (state.documents === 'pending') return [];

  const route = String(memory.knownFacts.residencia_tipo || '');
  const summaryArgs = {
    resumo: completionSummary(memory),
    motivo: route === 'terceiro_sem_contrato'
      ? 'Preparar declaração de residência antes do KIT CONSUMIDOR.'
      : 'KIT CONSUMIDOR assinado e documentos essenciais completos.',
  };

  if (route === 'terceiro_sem_contrato') {
    const ref = bindingRef(assistant, playbook, 'destino_declaracao_residencia', 'transferir_atendimento');
    if (ref && allowed.has('transferir_atendimento')) return [{
      action: 'transferir_atendimento', args: { ...summaryArgs, destino: ref.target_label }, ref,
    }];
    return allowed.has('transferir_para_humano')
      ? [{ action: 'transferir_para_humano', args: summaryArgs, ref: null }]
      : [];
  }

  if (state.kit === 'none') {
    const ref = bindingRef(assistant, playbook, 'modelo_kit_consumidor', 'enviar_documento');
    return ref && allowed.has('enviar_documento') ? [{
      action: 'enviar_documento',
      args: {
        documento: ref.target_label,
        mensagem: 'Seus documentos essenciais estão completos. Preencha e assine o KIT CONSUMIDOR. No campo Réu, coloque o nome do banco informado na triagem.',
      },
      ref,
    }] : [];
  }
  if (state.kit !== 'signed') return [];

  const ref = bindingRef(assistant, playbook, 'destino_pos_assinatura', 'transferir_atendimento');
  if (ref && allowed.has('transferir_atendimento')) return [{
    action: 'transferir_atendimento', args: { ...summaryArgs, destino: ref.target_label }, ref,
  }];
  return allowed.has('transferir_para_humano')
    ? [{ action: 'transferir_para_humano', args: summaryArgs, ref: null }]
    : [];
}

/**
 * O roteiro decide que terminou; esta função apenas materializa o fechamento
 * já configurado. Assim um modelo antigo não consegue esquecer documentos ou
 * transferência e também não escolhe um destino por texto livre.
 */
export function buildWaAiCompletionPlans(
  assistant: WaAiCompletionAssistant,
  playbook: WaAiCompletionPlaybook | null,
  memory: WaAiCompletionMemory,
  externalState: WaAiCompletionExternalState = { documents: 'none', kit: 'none' },
): WaAiCompletionPlan[] {
  if (!playbook) return [];
  if (playbook.id === 'bloqueio_encerramento_conta') {
    return buildAccountCompletionPlans(assistant, playbook, memory, externalState);
  }
  if (playbook.id !== 'sem_registro_carteira') return [];
  const allowed = new Set(assistant.allowed_actions || []);
  const plans: WaAiCompletionPlan[] = [];

  if (allowed.has('solicitar_documentos')) {
    const documentos = ['Documento de identificação com foto', 'CTPS Digital'];
    const provas = String(memory.knownFacts.provas || '').replace(/\s+/g, ' ').trim();
    if (provas) documentos.push(`Provas informadas: ${provas}`.slice(0, 120));
    plans.push({ action: 'solicitar_documentos', args: { documentos }, ref: null });
  }

  const ref = bindingRef(assistant, playbook, 'destino_triagem_concluida', 'transferir_atendimento');
  const args = {
    resumo: completionSummary(memory),
    motivo: 'Triagem concluída com os critérios mínimos confirmados.',
  };

  if (ref && allowed.has('transferir_atendimento')) {
    plans.push({
      action: 'transferir_atendimento', args: { ...args, destino: ref.target_label }, ref,
    });
  } else if (allowed.has('transferir_para_humano')) {
    plans.push({ action: 'transferir_para_humano', args, ref: null });
  }
  return plans;
}
