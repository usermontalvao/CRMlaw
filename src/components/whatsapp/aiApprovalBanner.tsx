// Banner de aprovação de resposta da IA (aprovar/editar/rejeitar).
import React, { useState } from 'react';
import { Bot } from 'lucide-react';
import { useToastContext } from '../../contexts/ToastContext';

export const AiApprovalBanner: React.FC<{
  session: import('../../types/whatsapp.types').WhatsAppAiSession;
  onDone: () => void;
}> = ({ session, onDone }) => {
  const [editMode, setEditMode] = useState(false);
  const [editedText, setEditedText] = useState(session.pending_ai_reply ?? '');
  const [loading, setLoading] = useState<'approve' | 'edit' | 'reject' | null>(null);
  const toast = useToastContext();

  const act = async (action: 'approve' | 'edit' | 'reject') => {
    setLoading(action);
    try {
      const { supabase } = await import('../../config/supabase');
      const { error } = await supabase.functions.invoke('whatsapp-ai-approve', {
        body: { session_id: session.id, action, edited_text: action === 'edit' ? editedText : undefined },
      });
      if (error) throw new Error(error.message);
      if (action === 'reject') toast.success('Resposta IA rejeitada — conversa devolvida para você');
      else toast.success(action === 'edit' ? 'Resposta editada e enviada' : 'Resposta IA aprovada e enviada');
      onDone();
    } catch (e) {
      toast.error('Erro', e instanceof Error ? e.message : 'Falha ao processar aprovação');
    } finally {
      setLoading(null);
    }
  };

  const isHandoff = session.pending_ai_next_step === -1;

  return (
    <div style={{ background: '#fef3c7', borderBottom: '1px solid #fde68a', padding: '10px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Bot size={14} style={{ color: '#d97706', flexShrink: 0 }} />
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#92400e' }}>
          {isHandoff ? 'IA quer encerrar o atendimento' : 'IA quer enviar mensagem — aguardando sua aprovação'}
        </span>
      </div>

      {editMode ? (
        <textarea
          value={editedText}
          onChange={e => setEditedText(e.target.value)}
          rows={3}
          style={{ width: '100%', fontSize: '12.5px', padding: '8px', borderRadius: '8px', border: '1px solid #fde68a', background: '#fffbeb', resize: 'vertical', outline: 'none', marginBottom: '8px' }}
        />
      ) : (
        <div style={{ fontSize: '12.5px', color: '#78350f', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 10px', marginBottom: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {session.pending_ai_reply}
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {editMode ? (
          <>
            <button
              disabled={loading !== null || !editedText.trim()}
              onClick={() => act('edit')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#d97706', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'edit' ? '…' : 'Enviar editada'}
            </button>
            <button onClick={() => setEditMode(false)} style={{ padding: '5px 12px', borderRadius: '7px', background: 'transparent', color: '#92400e', border: '1px solid #fde68a', fontSize: '12px', cursor: 'pointer' }}>
              Cancelar edição
            </button>
          </>
        ) : (
          <>
            <button
              disabled={loading !== null}
              onClick={() => act('approve')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#16a34a', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'approve' ? '…' : '✓ Aprovar e enviar'}
            </button>
            <button
              disabled={loading !== null}
              onClick={() => setEditMode(true)}
              style={{ padding: '5px 12px', borderRadius: '7px', background: '#f59e0b', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 700, cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              Editar
            </button>
            <button
              disabled={loading !== null}
              onClick={() => act('reject')}
              style={{ padding: '5px 12px', borderRadius: '7px', background: 'transparent', color: '#b45309', border: '1px solid #fde68a', fontSize: '12px', cursor: 'pointer', opacity: loading !== null ? 0.6 : 1 }}>
              {loading === 'reject' ? '…' : 'Rejeitar'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
