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

/** Dublês com dois "Pedro" de propósito: é o caso que a dica precisa desempatar. */
const TARGETS: WhatsAppAiTargetOption[] = [
  { type: 'user', id: '11111111-1111-4111-8111-111111111111', label: 'Pedro Rodrigues', hint: 'Advogado · Trabalhista' },
  { type: 'user', id: '22222222-2222-4222-8222-222222222222', label: 'Pedro Almeida', hint: 'Estagiário · Atendimento' },
  { type: 'user', id: '33333333-3333-4333-8333-333333333333', label: 'Lisliandra Neto', hint: 'Advogada · Previdenciário' },
  { type: 'department', id: '44444444-4444-4444-8444-444444444444', label: 'Trabalhista', hint: 'Setor' },
  { type: 'department', id: '55555555-5555-4555-8555-555555555555', label: 'Previdenciário', hint: 'Setor' },
  { type: 'document_template', id: '66666666-6666-4666-8666-666666666666', label: 'Kit Trabalhista', hint: 'Link ativo · /p/kit-trabalhista-28r7' },
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
  messages: { role: 'cliente' | 'agente'; text: string }[];
  trigger?: 'mensagem' | 'followup';
}): Promise<WhatsAppAiSimulationResult> => {
  await new Promise(r => setTimeout(r, 600));
  const turno = input.messages.filter(m => m.role === 'cliente').length;
  const followup = input.trigger === 'followup';

  const daqui = (horas: number) => new Date(Date.now() + horas * 3_600_000).toISOString();

  if (followup) {
    return {
      ok: true,
      reply: 'Oi! Passando para saber se você ainda tem interesse — consegue me mandar os documentos?',
      requested: [], executed: [],
      memory: { summary: 'Cliente sumiu depois da triagem.', knownFacts: { nome: 'Ana' }, pendingItems: ['documentos'], lastAction: '' },
      handed_off: false,
      followup: { attempt: 2, scheduled_at: daqui(4) },
      duration_ms: 610,
    };
  }

  if (turno >= 2) {
    return {
      ok: true,
      reply: 'Obrigado, Ana. Já tenho o que preciso — vou passar seu atendimento para a equipe trabalhista.',
      requested: [{ action: 'transferir_atendimento' }],
      executed: [{ action: 'transferir_atendimento', ok: true, simulated: true, target: 'Trabalhista' }],
      memory: { summary: 'Ana trabalhou sem registro por 8 meses.', knownFacts: { nome: 'Ana', assunto: 'sem registro' }, pendingItems: [], lastAction: 'transferir_atendimento (simulado)' },
      handed_off: true,
      followup: null,
      duration_ms: 1240,
    };
  }

  return {
    ok: true,
    reply: 'Olá! Tudo bem? Vou fazer algumas perguntas rápidas para entender seu caso.\nPara começar, qual é o seu nome?',
    requested: [], executed: [],
    memory: { summary: 'Primeiro contato.', knownFacts: {}, pendingItems: ['nome do cliente'], lastAction: '' },
    handed_off: false,
    followup: { attempt: 1, scheduled_at: daqui(2) },
    duration_ms: 780,
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
        onSave={refs => setSalvo({ ...draft, action_refs: refs })}
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
