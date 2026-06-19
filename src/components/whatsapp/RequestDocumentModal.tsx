// Modal de solicitação de documentos ao cliente (Fase I). Cria um document_request
// rastreável, registra trilha interna e opcionalmente envia a mensagem ao cliente.
// Extraído de WhatsAppModule.tsx — autocontido.
import React, { useEffect, useState } from 'react';
import { FilePlus, Loader2, Trash2, Plus } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput, waLabel, waBtnGhost, waBtnPrimary } from './ui';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';

const DOC_QUICK_ADD = ['Documento de identificação', 'Comprovante de residência', 'Extrato do FGTS', 'Carteira de trabalho', 'Holerite'];

type DocReqItem = { label: string; required: boolean };

export const RequestDocumentModal: React.FC<{
  conversationId: string;
  clientId: string;
  clientName: string | null;
  createdBy: string | null;
  onClose: () => void;
  onCreated?: () => void;
}> = ({ conversationId, clientId, clientName, createdBy, onClose, onCreated }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<DocReqItem[]>([{ label: '', required: true }]);
  const [dueDate, setDueDate] = useState('');
  const [sendMsg, setSendMsg] = useState(true);
  const [clientMsg, setClientMsg] = useState('');
  const [msgDirty, setMsgDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildMsg = (its: DocReqItem[], name: string | null) => {
    const firstName = (name || '').split(' ')[0] || '';
    const valid = its.filter(i => i.label.trim());
    const list = valid.map(i => `• ${i.label.trim()}${i.required ? '' : ' (opcional)'}`).join('\n');
    const head = `Olá${firstName ? `, ${firstName}` : ''}! Para darmos continuidade ao seu atendimento, precisamos que nos envie:`;
    return valid.length ? `${head}\n\n${list}` : `${head}\n\n`;
  };

  // Mantém a mensagem em sincronia com a lista de documentos, até o usuário editá-la.
  useEffect(() => {
    if (!msgDirty) setClientMsg(buildMsg(items, clientName));
  }, [items, clientName, msgDirty]);

  const setItem = (idx: number, patch: Partial<DocReqItem>) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addItem = (label = '') => setItems(prev => [...prev, { label, required: true }]);
  const removeItem = (idx: number) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);

  const validItems = items.filter(i => i.label.trim());

  const handleSave = async () => {
    if (validItems.length === 0) return;
    setSaving(true);
    try {
      const cleaned = validItems.map(i => ({ label: i.label.trim(), required: i.required }));
      const title = cleaned.length === 1 ? cleaned[0].label : 'Solicitação de documentos';
      // Registro rastreável: cria document_request + itens (status 'pending'),
      // que passa a aparecer em "Documentos pendentes" e no portal do cliente.
      await whatsappService.createDocumentRequest({
        clientId, title, dueDate: dueDate || null, createdBy, items: cleaned,
      });
      // Trilha interna na conversa (efeito colateral, não o registro principal).
      const noteList = cleaned.map(i => `${i.label}${i.required ? '' : ' (opcional)'}`).join(', ');
      await whatsappService.addNote(
        conversationId,
        `\u{1F4C4} Documentos solicitados: ${noteList}${dueDate ? ` (prazo ${new Date(dueDate + 'T00:00:00').toLocaleDateString('pt-BR')})` : ''}`,
      ).catch(() => {});
      if (sendMsg && clientMsg.trim()) {
        await whatsappService.sendText({ conversationId, text: clientMsg.trim() });
      }
      toast.success('Solicitação de documento registrada' + (sendMsg ? ' e mensagem enviada.' : '.'));
      onCreated?.();
      onClose();
    } catch (e: any) { toast.error('Erro ao registrar solicitação', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Solicitar documento"
      icon={<FilePlus size={18} />}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || validItems.length === 0} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FilePlus size={14} />}
            {sendMsg ? 'Solicitar e enviar' : 'Registrar solicitação'}
          </button>
        </div>
      }
    >
      <WaDialogBody className="space-y-4">
        <div>
          <label className={waLabel}>Documentos necessários *</label>
          <div className="space-y-1.5">
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <input autoFocus={idx === 0} value={it.label} onChange={e => setItem(idx, { label: e.target.value })}
                  placeholder="Ex: RG, comprovante de residência…"
                  className={`${waInput} flex-1 min-w-0`} />
                <button type="button" onClick={() => setItem(idx, { required: !it.required })}
                  title={it.required ? 'Obrigatório — clique para tornar opcional' : 'Opcional — clique para tornar obrigatório'}
                  className={`flex-shrink-0 px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition ${it.required ? 'border-[#00a884]/30 bg-[#00a884]/10 text-[#017561]' : 'border-[#e7e5df] bg-white text-slate-400'}`}>
                  {it.required ? 'Obrigatório' : 'Opcional'}
                </button>
                <button type="button" onClick={() => removeItem(idx)} disabled={items.length === 1}
                  className="flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-30 disabled:hover:bg-transparent transition">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem()}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#017561] hover:text-[#008069]">
            <Plus size={13} /> Adicionar documento
          </button>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DOC_QUICK_ADD.filter(q => !items.some(i => i.label.trim().toLowerCase() === q.toLowerCase())).map(q => (
              <button key={q} type="button"
                onClick={() => setItems(prev => { const blank = prev.findIndex(i => !i.label.trim()); if (blank >= 0) return prev.map((i, ix) => ix === blank ? { ...i, label: q } : i); return [...prev, { label: q, required: true }]; })}
                className="inline-flex items-center gap-1 rounded-full border border-[#e7e5df] bg-[#f9f8f6] px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-[#00a884] hover:bg-[#00a884]/10 hover:text-[#017561] transition">
                <Plus size={11} /> {q}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={waLabel}>Prazo para envio (opcional)</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={waInput} />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={sendMsg} onChange={e => setSendMsg(e.target.checked)}
            className="w-4 h-4 rounded accent-[#00a884]" />
          <span className="text-[12.5px] font-medium text-slate-700">Enviar mensagem ao cliente</span>
        </label>

        {sendMsg && (
          <div>
            <label className={waLabel}>Mensagem ao cliente</label>
            <textarea value={clientMsg} onChange={e => { setClientMsg(e.target.value); setMsgDirty(true); }} rows={6}
              className={`${waInput} resize-none`} />
            <p className="mt-1 text-[11px] text-slate-400">{msgDirty ? 'Mensagem editada manualmente.' : 'Atualiza automaticamente com a lista acima.'} Enviada pelo WhatsApp para o contato.</p>
          </div>
        )}
      </WaDialogBody>
    </WaDialog>
  );
};
