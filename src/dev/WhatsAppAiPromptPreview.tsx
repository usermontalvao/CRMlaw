/**
 * DEV-ONLY: bancada do editor de prompt do agente de IA (?waaipromptpreview=1).
 *
 * Abre o editor sozinho, sem login e sem banco: os destinos são dublês, então dá
 * para exercitar o autocomplete de `ação=` — menu de ações, segunda busca de
 * destino, teclado, validação e o resumo — sem depender do Supabase.
 *
 * Mesmo padrão das outras bancadas em src/dev/ (ver main.tsx).
 */
import React, { useMemo, useState } from 'react';
import { AiPromptEditor } from '../components/whatsapp/aiPromptEditor';
import {
  pruneWaAiActionRefs,
  validateWaAiPrompt,
  WA_AI_ACTIONS,
} from '../utils/waAiActionCatalog';
import type { WhatsAppAiActionRef, WhatsAppAiTargetOption } from '../types/whatsapp.types';

/** Dublês com dois "Pedro" de propósito: é o caso que a dica precisa desempatar. */
const TARGETS: WhatsAppAiTargetOption[] = [
  { type: 'user', id: '11111111-1111-4111-8111-111111111111', label: 'Pedro Rodrigues', hint: 'Advogado · Trabalhista' },
  { type: 'user', id: '22222222-2222-4222-8222-222222222222', label: 'Pedro Almeida', hint: 'Estagiário · Atendimento' },
  { type: 'user', id: '33333333-3333-4333-8333-333333333333', label: 'Lisliandra Neto', hint: 'Advogada · Previdenciário' },
  { type: 'department', id: '44444444-4444-4444-8444-444444444444', label: 'Trabalhista', hint: 'Setor' },
  { type: 'department', id: '55555555-5555-4555-8555-555555555555', label: 'Previdenciário', hint: 'Setor' },
  { type: 'document_template', id: '66666666-6666-4666-8666-666666666666', label: 'Kit Trabalhista', hint: 'Link ativo · /p/kit-trabalhista-28r7' },
];

const WhatsAppAiPromptPreview: React.FC = () => {
  const [text, setText] = useState(
    'Cumprimente pelo nome e descubra o assunto do contato.\n'
    + 'Pergunte o nome completo e o que aconteceu, uma coisa de cada vez.\n\n'
    + 'Se for assunto trabalhista, ',
  );
  const [refs, setRefs] = useState<WhatsAppAiActionRef[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);

  const liveRefs = useMemo(() => pruneWaAiActionRefs(refs, text), [refs, text]);
  const issues = useMemo(() => validateWaAiPrompt(text, liveRefs, allowed), [text, liveRefs, allowed]);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
        Editor de prompt do agente — bancada
      </h1>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '20px' }}>
        Digite <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: '4px' }}>ação=</code> no
        texto abaixo. Setas navegam, Enter seleciona, Esc fecha.
      </p>

      <AiPromptEditor
        value={text}
        onChange={setText}
        refs={liveRefs}
        onAddRef={ref => setRefs(prev =>
          prev.some(r => r.action === ref.action && r.target_id === ref.target_id) ? prev : [...prev, ref])}
        onUseAction={action => setAllowed(prev => prev.includes(action) ? prev : [...prev, action])}
        targets={TARGETS}
        issues={issues}
        rows={12}
      />

      <div style={{ marginTop: '24px', padding: '14px', background: '#f9fafb', borderRadius: '10px' }}>
        <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '8px' }}>
          Ações marcadas automaticamente ({allowed.length})
        </p>
        <ul style={{ fontSize: '12px', color: '#6b7280', paddingLeft: '16px', listStyle: 'disc' }}>
          {allowed.length === 0 && <li style={{ listStyle: 'none', marginLeft: '-16px' }}>nenhuma ainda</li>}
          {allowed.map(a => <li key={a}>{WA_AI_ACTIONS.find(d => d.name === a)?.title || a}</li>)}
        </ul>

        <p style={{ fontSize: '12px', fontWeight: 700, color: '#374151', margin: '14px 0 8px' }}>
          Referências compiladas (o que o backend usa para executar)
        </p>
        <pre style={{
          fontSize: '11px', color: '#374151', background: '#fff', padding: '10px',
          borderRadius: '8px', overflowX: 'auto', margin: 0,
        }}>{JSON.stringify(liveRefs, null, 2)}</pre>
      </div>
    </div>
  );
};

export default WhatsAppAiPromptPreview;
