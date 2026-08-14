// Modal de solicitação de documentos ao cliente (Fase I). Cria um document_request
// rastreável, registra trilha interna e opcionalmente envia a mensagem ao cliente.
// Extraído de WhatsAppModule.tsx — autocontido.
import React, { useEffect, useState } from 'react';
import { BookmarkPlus, FilePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import { WaDialog, WaDialogBody, WaDialogActions, waInput, waLabel, waBtnGhost, waBtnPrimary } from './ui';
import { whatsappService, renderTemplate } from '../../services/whatsapp.service';
import { sendTextResilient } from '../../services/whatsapp/resilientSend';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppModuleConfig } from '../../services/settings.service';
import {
  addDocumentRequestPreset,
  removeDocumentRequestPreset,
} from '../../utils/documentRequestPresets';

type DocReqItem = { label: string; required: boolean };

export const RequestDocumentModal: React.FC<{
  conversationId: string;
  clientId: string;
  clientName: string | null;
  createdBy: string | null;
  moduleConfig: WhatsAppModuleConfig;
  onClose: () => void;
  onCreated?: () => void;
}> = ({ conversationId, clientId, clientName, createdBy, moduleConfig, onClose, onCreated }) => {
  const toast = useToastContext();
  // A solicitação e o catálogo começam vazios. Os padrões carregados abaixo são
  // pessoais e nunca entram automaticamente na lista enviada ao cliente.
  const [items, setItems] = useState<DocReqItem[]>([]);
  const [presets, setPresets] = useState<string[]>([]);
  const [newPreset, setNewPreset] = useState('');
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [savingPresets, setSavingPresets] = useState(false);
  const [presetError, setPresetError] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sendMsg, setSendMsg] = useState(true);
  const [clientMsg, setClientMsg] = useState('');
  const [msgDirty, setMsgDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const buildMsg = (its: DocReqItem[], name: string | null) => {
    const valid = its.filter(i => i.label.trim());
    const list = valid.map(i => `• ${i.label.trim()}${i.required ? '' : ' (opcional)'}`).join('\n');
    return renderTemplate(moduleConfig.document_request_message_template, {
      clientName: name,
      extraVars: { itens: list },
    });
  };

  // Mantém a mensagem em sincronia com a lista de documentos, até o usuário editá-la.
  useEffect(() => {
    if (!msgDirty) setClientMsg(buildMsg(items, clientName));
  }, [items, clientName, msgDirty, moduleConfig.document_request_message_template]);

  useEffect(() => {
    let active = true;
    whatsappService.getMyDocumentRequestPresets()
      .then(list => { if (active) setPresets(list); })
      .catch(() => { if (active) setPresetError('Não foi possível carregar seus padrões.'); })
      .finally(() => { if (active) setLoadingPresets(false); });
    return () => { active = false; };
  }, []);

  const setItem = (idx: number, patch: Partial<DocReqItem>) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const addItem = (label = '') => setItems(prev => [...prev, { label, required: true }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const validItems = items.filter(i => i.label.trim());
  const usados = new Set(items.map(i => i.label.trim().toLowerCase()).filter(Boolean));
  // Aproveita a linha em branco que o formulário sempre deixa aberta, em vez de
  // empilhar uma vazia embaixo de cada documento escolhido.
  const quickAdd = (label: string) => setItems(prev => {
    const blank = prev.findIndex(i => !i.label.trim());
    if (blank >= 0) return prev.map((i, ix) => ix === blank ? { ...i, label } : i);
    return [...prev, { label, required: true }];
  });

  const savePresets = async (next: string[]) => {
    setSavingPresets(true);
    setPresetError('');
    try {
      const saved = await whatsappService.saveMyDocumentRequestPresets(next);
      setPresets(saved);
      return true;
    } catch (e: any) {
      setPresetError(e?.message || 'Não foi possível salvar seus padrões.');
      return false;
    } finally {
      setSavingPresets(false);
    }
  };

  const handleAddPreset = async () => {
    const label = newPreset.trim();
    if (!label) return;
    const next = addDocumentRequestPreset(presets, label);
    if (next.length === presets.length) {
      setPresetError('Esse padrão já está cadastrado.');
      return;
    }
    if (await savePresets(next)) setNewPreset('');
  };

  const handleRemovePreset = async (label: string) => {
    await savePresets(removeDocumentRequestPreset(presets, label));
  };

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
      let queued = false;
      if (sendMsg && clientMsg.trim()) {
        // Resiliente: canal fora → mensagem retida para reenvio automático.
        const r = await sendTextResilient({ conversationId, text: clientMsg.trim() });
        queued = r.queued;
      }
      toast.success(
        'Solicitação de documento registrada' +
        (sendMsg ? (queued ? '. Mensagem na fila (reenvio automático ao reconectar).' : ' e mensagem enviada.') : '.'),
      );
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
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={handleSave} disabled={saving || validItems.length === 0} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <FilePlus size={14} />}
            {sendMsg ? 'Solicitar e enviar' : 'Registrar solicitação'}
          </button>
        </WaDialogActions>
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
                <button type="button" onClick={() => removeItem(idx)} title="Remover documento"
                  className="flex-shrink-0 p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => addItem()}
            className="mt-2 inline-flex items-center gap-1 text-[12px] font-semibold text-[#017561] hover:text-[#008069]">
            <Plus size={13} /> Adicionar documento
          </button>

          <div className="mt-4 rounded-xl border border-[#e7e5df] bg-[#faf9f7] p-3">
            <div className="flex items-center gap-1.5">
              <BookmarkPlus size={14} className="text-[#017561]" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Meus padrões</span>
              <span className="ml-auto text-[10px] text-slate-400">Sua lista pessoal</span>
            </div>

            {loadingPresets ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Loader2 size={12} className="animate-spin" /> Carregando…
              </div>
            ) : presets.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-400">Nenhum padrão cadastrado.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {presets.map(label => {
                  const alreadyUsed = usados.has(label.trim().toLowerCase());
                  return (
                    <div key={label} className="inline-flex overflow-hidden rounded-full border border-[#e7e5df] bg-white">
                      <button type="button" onClick={() => quickAdd(label)} disabled={alreadyUsed || savingPresets}
                        title={alreadyUsed ? 'Já adicionado à solicitação' : 'Adicionar à solicitação'}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-[#00a884]/10 hover:text-[#017561] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-white disabled:hover:text-slate-600 transition">
                        <Plus size={11} /> {label}
                      </button>
                      <button type="button" onClick={() => handleRemovePreset(label)} disabled={savingPresets}
                        title={`Remover o padrão ${label}`}
                        aria-label={`Remover o padrão ${label}`}
                        className="border-l border-[#e7e5df] px-1.5 text-slate-300 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 transition">
                        <X size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-2 flex gap-1.5">
              <input value={newPreset} onChange={e => { setNewPreset(e.target.value); setPresetError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddPreset(); } }}
                maxLength={120} disabled={loadingPresets || savingPresets}
                placeholder="Ex: Documento de identificação"
                aria-label="Nome do novo padrão"
                className={`${waInput} min-w-0 flex-1 !py-1.5 !text-[11px]`} />
              <button type="button" onClick={handleAddPreset}
                disabled={!newPreset.trim() || loadingPresets || savingPresets}
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-[#00a884]/30 bg-[#00a884]/10 px-2.5 text-[11px] font-semibold text-[#017561] hover:bg-[#00a884]/15 disabled:opacity-45 transition">
                {savingPresets ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                Salvar padrão
              </button>
            </div>
            {presetError && <p role="alert" className="mt-1.5 text-[10.5px] text-rose-500">{presetError}</p>}
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
