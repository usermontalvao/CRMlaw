/**
 * DEV-ONLY: bancada do formulário do agente de IA (?waaiagentpreview=1).
 *
 * Abre o formulário inteiro sem login e sem banco — destinos são dublês. Serve
 * para conferir a divulgação progressiva nas duas situações reais: agente NOVO
 * (tudo no padrão) e agente EM EDIÇÃO (seções fechadas mostrando o resumo do
 * que já está configurado).
 *
 * Mesmo padrão das outras bancadas em src/dev/ (ver main.tsx).
 */
import React, { useState } from 'react';
import { AiAssistantForm } from '../components/whatsapp/aiAssistantForm';
import { AiAgentSimulator } from '../components/whatsapp/aiAgentSimulator';
import type {
  WhatsAppAiAssistantInput, WhatsAppAiSimulationResult, WhatsAppAiTargetOption,
} from '../types/whatsapp.types';
import {
  WA_AI_PLAYBOOK_SEM_REGISTRO,
  computeWaAiTriageNextAction,
  computeWaAiTriageProgress,
  normalizeWaAiPlaybook,
  normalizeWaAiPlaybookValue,
  waAiPlaybookField,
} from '../utils/waAiPlaybook';
import { reconcileWaAiTriageState, type WaAiTriageTurn } from '../utils/waAiTriageFacts';
import { buildWaAiCompletionPlans } from '../utils/waAiCompletion';

/** Dublês com dois "Pedro" de propósito: é o caso que a dica precisa desempatar. */
const TARGETS: WhatsAppAiTargetOption[] = [
  { type: 'user', id: '11111111-1111-4111-8111-111111111111', label: 'Pedro Rodrigues Montalvao Neto', hint: 'Advogado · Trabalhista' },
  { type: 'user', id: '22222222-2222-4222-8222-222222222222', label: 'Pedro Almeida', hint: 'Estagiário · Atendimento' },
  { type: 'user', id: '33333333-3333-4333-8333-333333333333', label: 'Lisliandra Neto', hint: 'Advogada · Previdenciário' },
  { type: 'department', id: '44444444-4444-4444-8444-444444444444', label: 'Trabalhista', hint: 'Setor' },
  { type: 'department', id: '55555555-5555-4555-8555-555555555555', label: 'Previdenciário', hint: 'Setor' },
  { type: 'department', id: '77777777-7777-4777-8777-777777777777', label: 'Atendimento', hint: 'Setor' },
  { type: 'document_template', id: '66666666-6666-4666-8666-666666666666', label: 'Kit Trabalhista', hint: 'Link ativo · /p/kit-trabalhista-28r7' },
  { type: 'document_template', id: '88888888-8888-4888-8888-888888888888', label: 'KIT CONSUMIDOR', hint: 'Preenchimento e assinatura' },
];

const NEW_DRAFT: WhatsAppAiAssistantInput = {
  name: '',
  description: '',
  provider: 'openai',
  model: 'gpt-4o-mini',
  is_active: true,
  mode: 'test',
  instructions_do: '',
  instructions_dont: '',
  allowed_actions: [],
  action_refs: [],
  followup_enabled: false,
  followup_instructions: '',
  followup_max_attempts: 3,
  followup_strategy: 'fixed',
  followup_interval_hours: 24,
  followup_custom_hours: [],
  followup_days: [1, 2, 3, 4, 5],
  followup_start_minute: 480,
  followup_end_minute: 1080,
  timezone: 'America/Cuiaba',
  debounce_seconds: 8,
  history_limit: 12,
};

/** Agente já configurado: é o que testa os resumos das seções fechadas. */
const EDIT_DRAFT: WhatsAppAiAssistantInput = {
  ...NEW_DRAFT,
  name: 'Triagem inicial',
  description: 'Recebe o primeiro contato e encaminha ao setor certo.',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  mode: 'auto',
  instructions_do:
    'Cumprimente pelo nome e descubra o assunto do contato.\n'
    + 'Pergunte o nome completo e o que aconteceu, uma coisa de cada vez.\n'
    + 'Se for assunto trabalhista, ação=transferir(Trabalhista) com um resumo do caso.',
  instructions_dont:
    'Nunca prometa resultado nem estime valores de indenização.\nNunca informe honorários.',
  allowed_actions: ['transferir_atendimento', 'solicitar_documentos', 'transferir_para_humano'],
  action_refs: [{
    action: 'transferir_atendimento',
    target_type: 'department',
    target_id: '44444444-4444-4444-8444-444444444444',
    target_label: 'Trabalhista',
    raw: 'ação=transferir(Trabalhista)',
  }],
  followup_enabled: true,
  followup_instructions: 'Retome de forma leve, lembrando o que ficou pendente.',
  followup_max_attempts: 2,
  followup_interval_hours: 24,
  debounce_seconds: 10,
  history_limit: 16,
  // Mantém o texto antigo de propósito: a bancada comprova que, com contexto
  // estruturado, ele deixa de aparecer como editor principal e será limpo ao salvar.
  playbook: JSON.parse(JSON.stringify(WA_AI_PLAYBOOK_SEM_REGISTRO)),
};

/** Os botões vêm do CSS de Configurações, que não existe fora do CRM. */
const BUTTON_CSS = `
  .settings-btn-primary {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 9px 20px; font-size: 13px; font-weight: 600; color: #fff;
    background: #ea6c00; border: none; border-radius: 9px; cursor: pointer;
  }
  .settings-btn-primary:disabled { opacity: .5; cursor: not-allowed; }
  .settings-btn-ghost {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 500; color: #555f6e;
    background: transparent; border: 1px solid rgba(15,23,42,.11); border-radius: 9px; cursor: pointer;
  }
`;


/**
 * Dublê do motor: a bancada não tem sessão nem Edge Function, então as
 * respostas são roteirizadas. Serve para conferir o VISUAL da prévia — bolhas,
 * chips de ação simulada, memória e o aviso de acompanhamento.
 */
const runTurnDublê = async (input: {
  assistant: WhatsAppAiAssistantInput;
  messages: { role: 'cliente' | 'agente'; text: string }[];
  memory?: WhatsAppAiSimulationResult['memory'] | null;
  contactName?: string;
  trigger?: 'mensagem' | 'followup';
  followupAttempt?: number;
}): Promise<WhatsAppAiSimulationResult> => {
  await new Promise(r => setTimeout(r, 180));
  const followup = input.trigger === 'followup';
  const playbook = normalizeWaAiPlaybook(input.assistant.playbook);
  if (!playbook) throw new Error('Escolha uma campanha estruturada antes de testar.');

  const before = { ...(input.memory?.knownFacts || {}) };
  const prior = computeWaAiTriageProgress({
    playbook, facts: before, timeZone: input.assistant.timezone || 'America/Cuiaba',
  });
  const lastInbound = [...input.messages].reverse().find(message => message.role === 'cliente')?.text.trim() || '';
  const turns: WaAiTriageTurn[] = input.messages.map((message, index) => ({
    direction: message.role === 'cliente' ? 'in' : 'out',
    text: message.text,
    at: new Date(Date.now() - (input.messages.length - index) * 1000).toISOString(),
  }));
  // A primeira fala é a resposta à campanha, não a resposta à primeira
  // pergunta do roteiro: essa pergunta ainda nem foi feita. Sem esse corte,
  // uma abertura humana como "Oi, vi o anúncio sobre conta encerrada" virava o
  // nome do cliente e a prévia pulava direto para o banco.
  const firstClientTurn = input.messages.filter(message => message.role === 'cliente').length === 1
    && !input.messages.some(message => message.role === 'agente');
  const reconciled = reconcileWaAiTriageState({
    knownFacts: before,
    pendingItems: input.memory?.pendingItems || [],
    turns,
    playbookKeys: playbook.fields.map(field => field.key),
  });
  const facts = { ...reconciled.knownFacts };

  // O dublê não chama modelo. Para texto livre, a resposta à pergunta atual é
  // suficiente; datas, sim/não e listas continuam passando pelos mesmos
  // normalizadores e extratores determinísticos do motor real.
  const greetingOnly = /^(oi+e*|ol[aá]|bom dia|boa tarde|boa noite|tudo bem)[!?. ]*$/i.test(lastInbound);
  if (!followup && !firstClientTurn && prior.nextField && lastInbound
    && !(prior.nextField === 'nome' && greetingOnly)) {
    const field = waAiPlaybookField(playbook, prior.nextField);
    if (field && (facts[field.key] === undefined || facts[field.key] === '')) {
      const normalized = normalizeWaAiPlaybookValue(field, lastInbound);
      if (normalized) facts[field.key] = normalized;
    }
  }

  const progress = computeWaAiTriageProgress({
    playbook, facts, timeZone: input.assistant.timezone || 'America/Cuiaba',
  });
  const nextAction = computeWaAiTriageNextAction(playbook, progress);
  const attempt = Math.max(1, Number(input.followupAttempt || 1));
  const interval = Math.max(1, Number(input.assistant.followup_interval_hours || 24));
  const scheduled = new Date(Date.now() + interval * 3_600_000).toISOString();

  let reply = '';
  let requested: WhatsAppAiSimulationResult['requested'] = [];
  let executed: WhatsAppAiSimulationResult['executed'] = [];
  let lastAction = '';
  if (progress.cut) {
    const messages: Record<string, string> = {
      prazo_2_anos_conta: 'Pela data informada, o caso ficou fora do período atendido pelo escritório. Por isso não vou pedir documentos por esta campanha.',
      houve_aviso_previo: 'Esta campanha atende bloqueio ou encerramento sem aviso prévio. Como o banco avisou antes, seu relato ficou fora dos critérios desta triagem.',
      sem_print_conta: 'O print, e-mail ou tela do aplicativo é um documento essencial. Quando conseguir essa imagem, pode voltar ao atendimento.',
      declarante_sem_documento: 'Para preparar a declaração, precisamos da foto do documento de identificação do declarante. Quando conseguir, pode voltar ao atendimento.',
      honorarios_nao_aceitos: 'Tudo bem, respeito sua decisão. Não vou seguir com a contratação por esta campanha.',
    };
    reply = messages[progress.cut.id]
      || 'Pelas informações dadas, a situação ficou fora dos critérios desta triagem.';
    lastAction = `corte: ${progress.cut.id}`;
  } else if (progress.complete) {
    const plans = buildWaAiCompletionPlans({
      allowed_actions: ['solicitar_documentos', 'enviar_documento', 'transferir_atendimento', 'transferir_para_humano'],
      action_refs: (input.assistant.action_refs || []) as any,
    }, playbook, { knownFacts: facts, pendingItems: [] });
    const plan = plans[0];
    if (plan) {
      requested = [{ action: plan.action, args: plan.args }];
      executed = [{ action: plan.action, args: plan.args, ok: true, simulated: true,
        target: plan.ref?.target_label || null }];
      lastAction = `${plan.action} (simulado)`;
    }
    reply = 'A triagem terminou. Vou solicitar os documentos essenciais agora. Você pode enviar um por vez por aqui mesmo.';
  } else {
    const question = nextAction?.type === 'ask_field'
      ? nextAction.question
      : waAiPlaybookField(playbook, progress.nextField || '')?.question;
    reply = followup
      ? `Olá${facts.nome ? `, ${String(facts.nome).split(' ')[0]}` : ''}! Ficou faltando só esta informação: ${question}`
      : (firstClientTurn || (greetingOnly && Object.keys(before).length === 0)
        ? `${playbook.opening || question || 'Como posso ajudar?'}`
        : `${lastInbound && prior.nextField === progress.nextField ? 'Sem problema, vou perguntar de outro jeito. ' : ''}${question || 'Pode me contar um pouco mais?'}`);
  }

  return {
    ok: true, reply, requested, executed,
    memory: {
      summary: `Triagem ${playbook.label}${facts.nome ? ` · ${facts.nome}` : ''}.`,
      knownFacts: facts,
      pendingItems: progress.pending,
      lastAction,
    },
    handed_off: executed.some(item => item.action === 'transferir_atendimento'),
    followup: input.assistant.followup_enabled && !progress.cut && !progress.complete
      ? { attempt, scheduled_at: scheduled } : null,
    triage: {
      stage: progress.stage,
      stage_label: progress.stageLabel,
      pending: progress.pending,
      next_field: progress.nextField,
      next_action: nextAction,
      cut: progress.cut,
      complete: progress.complete,
    },
    duration_ms: 180,
  };
};

const WhatsAppAiAgentFormPreview: React.FC = () => {
  const [modo, setModo] = useState<'novo' | 'edicao'>('novo');
  const [draft, setDraft] = useState<WhatsAppAiAssistantInput>({ ...NEW_DRAFT });
  const [salvo, setSalvo] = useState<unknown>(null);
  const [previa, setPrevia] = useState(false);

  const trocar = (next: 'novo' | 'edicao') => {
    setModo(next);
    setDraft({ ...(next === 'novo' ? NEW_DRAFT : EDIT_DRAFT) });
    setSalvo(null);
  };

  return (
    <div style={{
      maxWidth: '880px', margin: '0 auto', padding: '28px 24px',
      fontFamily: 'system-ui, sans-serif', background: '#fafafa', minHeight: '100vh',
    }}>
      <style>{BUTTON_CSS}</style>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
        Formulário do agente de IA — bancada
      </h1>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '14px' }}>
        Mesma tela de Configurações › WhatsApp › Agentes de IA, sem banco.
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px' }}>
        {(['novo', 'edicao'] as const).map(m => (
          <button key={m} type="button" onClick={() => trocar(m)}
            style={{
              fontSize: '12.5px', fontWeight: 600, padding: '6px 14px', borderRadius: '999px', cursor: 'pointer',
              border: `1px solid ${modo === m ? '#ea6c00' : '#d1d5db'}`,
              background: modo === m ? '#fff7ed' : '#fff',
              color: modo === m ? '#b45309' : '#6b7280',
            }}>
            {m === 'novo' ? 'Criar agente' : 'Editar agente'}
          </button>
        ))}
        <button type="button" onClick={() => setPrevia(true)}
          style={{
            fontSize: '12.5px', fontWeight: 600, padding: '6px 14px', borderRadius: '999px',
            cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#6b7280',
          }}>
          Prévia do agente (dublê)
        </button>
      </div>

      {previa && (
        <AiAgentSimulator draft={draft} onClose={() => setPrevia(false)} runTurn={runTurnDublê} />
      )}

      <AiAssistantForm
        key={modo}
        draft={draft}
        targets={TARGETS}
        saving={false}
        onPatch={p => setDraft(prev => ({ ...prev, ...p }))}
        onCancel={() => setSalvo({ cancelado: true })}
        onSave={(refs, allowedActions) => setSalvo({
          ...draft, action_refs: refs, allowed_actions: allowedActions,
        })}
      />

      {salvo !== null && (
        <pre style={{
          marginTop: '18px', fontSize: '11px', color: '#374151', background: '#fff',
          padding: '12px', borderRadius: '10px', border: '1px solid #e7e5df', overflowX: 'auto',
        }}>{JSON.stringify(salvo, null, 2)}</pre>
      )}
    </div>
  );
};

export default WhatsAppAiAgentFormPreview;
