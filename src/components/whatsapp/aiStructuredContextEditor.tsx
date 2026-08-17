import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Braces, CheckCircle2 } from 'lucide-react';
import {
  normalizeWaAiPlaybook,
  type WaAiPlaybook,
} from '../../utils/waAiPlaybook';

interface Props {
  value: Record<string, unknown> | null | undefined;
  resolvedPlaybook: WaAiPlaybook | null;
  onChange: (context: Record<string, unknown>) => void;
}

/**
 * Editor principal do agente. Ele mostra somente o contexto fornecido pelo
 * usuário; campos, etapas e cortes continuam materializados no playbook que o
 * backend valida. Um JSON incompleto nunca substitui o último valor válido.
 */
export const AiStructuredContextEditor: React.FC<Props> = ({
  value, resolvedPlaybook, onChange,
}) => {
  const serialized = useMemo(() => JSON.stringify(value || {}, null, 2), [value]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);
  const lastApplied = useRef(serialized);

  useEffect(() => {
    if (serialized === lastApplied.current) return;
    lastApplied.current = serialized;
    setText(serialized);
    setError(null);
  }, [serialized]);

  const update = (next: string) => {
    setText(next);
    // Apagar tudo é uma intenção válida: remove o roteiro, os vínculos e os
    // campos derivados. Antes isso caía no JSON.parse, virava erro e deixava o
    // último roteiro ativo escondido atrás de um textarea vazio.
    if (!next.trim()) {
      setError(null);
      lastApplied.current = '{}';
      onChange({});
      return;
    }
    try {
      const parsed = JSON.parse(next);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('A configuração precisa ser um objeto JSON, começando com { e terminando com }.');
        return;
      }
      const object = parsed as Record<string, unknown>;
      setError(null);
      lastApplied.current = JSON.stringify(object, null, 2);
      onChange(object);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'JSON inválido.');
    }
  };

  const detectedFromText = useMemo(() => {
    try { return normalizeWaAiPlaybook(JSON.parse(text)); } catch { return null; }
  }, [text]);
  const detected = detectedFromText || resolvedPlaybook;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
      {/* Havia aqui dois botões de "restaurar modelo" de campanha. Um clique
          sobrescrevia todo o JSON já configurado do agente, sem confirmação —
          e a lista de campanhas não tem por que morar dentro deste editor. */}
      <p style={{ fontSize: '11.5px', color: '#6b7280', margin: 0 }}>
        Cole aqui a configuração estruturada. O sistema identifica a campanha e transforma
        automaticamente as informações do roteiro em campos tipados para salvar a resposta.
      </p>

      <div style={{ position: 'relative' }}>
        <Braces size={16} style={{ position: 'absolute', top: '11px', right: '11px', color: '#9ca3af' }} />
        <textarea
          id="wa-ai-structured-context"
          aria-label="Configuração JSON do agente"
          spellCheck={false}
          value={text}
          onChange={event => update(event.target.value)}
          style={{
            width: '100%', minHeight: '430px', resize: 'vertical', boxSizing: 'border-box',
            padding: '10px 34px 10px 11px', borderRadius: '9px',
            border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`,
            background: '#111827', color: '#e5e7eb', fontSize: '11.5px', lineHeight: 1.5,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        />
      </div>

      {!text.trim() ? (
        <p style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: 0,
          fontSize: '11.5px', color: '#475569' }}>
          <CheckCircle2 size={13} />
          Roteiro estruturado removido. As seleções e os campos derivados foram limpos; salve o agente para confirmar.
        </p>
      ) : error ? (
        <p role="alert" style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: 0,
          fontSize: '11.5px', color: '#991b1b' }}>
          <AlertTriangle size={12} /> {error} O último JSON válido continua ativo.
        </p>
      ) : detected ? (
        <p style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: 0,
          fontSize: '11.5px', color: '#166534' }}>
          <CheckCircle2 size={13} />
          Campanha identificada: {detected.fields.length} campos para salvar automaticamente,
          {` ${detected.stages.length}`} etapas e {detected.cuts.length} cortes.
        </p>
      ) : (
        <p style={{ display: 'flex', gap: '6px', alignItems: 'center', margin: 0,
          fontSize: '11.5px', color: '#92400e' }}>
          <AlertTriangle size={12} /> JSON válido, mas nenhuma campanha com roteiro automático foi identificada.
        </p>
      )}
    </div>
  );
};

export default AiStructuredContextEditor;
