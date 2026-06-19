// Modais ligados à composição de mensagens: seletor de modelos/macros e
// agendamento de mensagem. Extraídos de WhatsAppModule.tsx — autocontidos.
import React, { useCallback, useEffect, useState } from 'react';
import { MessageSquare, CalendarClock, Plus, Loader2, Trash2 } from 'lucide-react';
import { WaDialog, WaDialogBody, waInput, waLabel, waBtnGhost, waBtnPrimary } from './ui';
import { whatsappService, renderTemplate } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppTemplate } from '../../types/whatsapp.types';
import type { WhatsAppConversation } from '../../types/whatsapp.types';

// ── Seletor de templates/macros (Fase 8) ──
export const TemplatePickerModal: React.FC<{
  context: { clientName?: string | null; clientPhone?: string | null; agentName?: string | null; greeting?: string | null };
  onClose: () => void;
  onPick: (text: string) => void;
}> = ({ context, onClose, onPick }) => {
  const toast = useToastContext();
  const [templates, setTemplates] = useState<WhatsAppTemplate[] | null>(null);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);     // mostra o formulário de novo modelo
  const [newName, setNewName] = useState('');
  const [newBody, setNewBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(() => {
    whatsappService.listTemplates({ activeOnly: true })
      .then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = (templates || []).filter(t =>
    !q.trim() || t.name.toLowerCase().includes(q.toLowerCase()) || (t.category || '').toLowerCase().includes(q.toLowerCase()));

  const createNew = async () => {
    if (!newName.trim() || !newBody.trim()) return;
    setSaving(true);
    try {
      await whatsappService.createTemplate({ name: newName.trim(), body: newBody.trim() });
      toast.success('Modelo criado.');
      setNewName(''); setNewBody(''); setCreating(false);
      load();
    } catch (e: any) { toast.error('Falha ao criar modelo', e.message); }
    finally { setSaving(false); }
  };

  const remove = async (t: WhatsAppTemplate) => {
    setDeletingId(t.id);
    try {
      await whatsappService.deleteTemplate(t.id);
      setTemplates(prev => (prev || []).filter(x => x.id !== t.id));
    } catch (e: any) { toast.error('Falha ao excluir modelo', e.message); }
    finally { setDeletingId(null); }
  };

  return (
    <WaDialog title="Modelos de mensagem" icon={<MessageSquare size={18} />} onClose={onClose}
      headerActions={
        <button onClick={() => setCreating(c => !c)} title="Novo modelo"
          className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white/15 hover:bg-white/25 px-2.5 py-1 text-[12px] font-semibold text-white transition">
          <Plus size={13} /> Novo
        </button>
      }>
      {/* Formulário de novo modelo */}
      {creating && (
        <div className="px-4 sm:px-5 py-3 border-b border-[#f1f0ec] bg-[#f7f9fa] space-y-2">
          <div>
            <label className={waLabel}>Atalho / título <span className="font-normal text-slate-400">(ex: boas-vindas → digite /boas)</span></label>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} placeholder="boas-vindas" className={waInput} />
          </div>
          <div>
            <label className={waLabel}>Texto da mensagem</label>
            <textarea value={newBody} onChange={e => setNewBody(e.target.value)} rows={3}
              placeholder="Olá! Seja bem-vindo(a) ao nosso escritório…" className={`${waInput} resize-none`} />
            <p className="mt-1 text-[10.5px] text-slate-400">Variáveis: {'{{cliente.nome}}'}, {'{{saudacao}}'}, {'{{agente.nome}}'}.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setCreating(false); setNewName(''); setNewBody(''); }} className={waBtnGhost}>Cancelar</button>
            <button onClick={createNew} disabled={saving || !newName.trim() || !newBody.trim()} className={waBtnPrimary}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Salvar modelo
            </button>
          </div>
        </div>
      )}

      <div className="px-4 sm:px-5 py-3 border-b border-[#f1f0ec]">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar modelo…" className={waInput} />
      </div>
      <div className="px-4 sm:px-5 py-3 space-y-2">
        {templates === null ? (
          <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[13px] text-slate-400 py-6">Nenhum modelo. Clique em <strong>Novo</strong> para cadastrar.</p>
        ) : filtered.map(t => {
          const preview = renderTemplate(t.body, context);
          return (
            <div key={t.id}
              className="group/tpl relative rounded-xl border border-[#e7e5df] hover:border-[#00a884] hover:bg-[#00a884]/5 transition">
              <button onClick={() => onPick(preview)} className="w-full text-left p-3 pr-9">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-700">
                    <span className="text-[#00a884]">/</span>{t.name}
                  </span>
                  {t.category && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">{t.category}</span>}
                </div>
                <p className="text-[12px] text-slate-500 line-clamp-3 whitespace-pre-wrap break-words">{preview}</p>
              </button>
              <button onClick={() => remove(t)} disabled={deletingId === t.id} title="Excluir modelo"
                className="absolute top-2 right-2 p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover/tpl:opacity-100 transition disabled:opacity-50">
                {deletingId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          );
        })}
      </div>
    </WaDialog>
  );
};

// ── Agendar mensagem (Fase 8.1) ──
export const ScheduleMessageModal: React.FC<{
  conversation: WhatsAppConversation;
  initialText: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ conversation, initialText, onClose, onDone }) => {
  const toast = useToastContext();
  const [text, setText] = useState(initialText);
  const [when, setWhen] = useState('');
  const [saving, setSaving] = useState(false);

  // datetime-local mínimo: agora + 90s (buffer de envio). Recomputa a cada 30s para
  // que o input não aceite datas que já ficaram no passado enquanto o modal estava aberto.
  const computeMin = () => {
    const d = new Date(Date.now() + 90000 - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  };
  const [minLocal, setMinLocal] = useState(computeMin);
  useEffect(() => {
    const t = setInterval(() => setMinLocal(computeMin()), 30000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!text.trim() || !when) return;
    // Valida localmente com 30s de tolerância para absorver latência de rede.
    if (new Date(when).getTime() < Date.now() + 30000) {
      toast.error('Horário inválido', 'Escolha uma data e hora com pelo menos 1 minuto no futuro.');
      return;
    }
    setSaving(true);
    try {
      await whatsappService.scheduleMessage({
        conversationId: conversation.id,
        channelId: conversation.instance_id,
        scheduledAt: new Date(when).toISOString(),
        text,
      });
      onDone();
    } catch (e: any) { toast.error('Falha ao agendar', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog
      title="Agendar mensagem"
      icon={<CalendarClock size={18} />}
      onClose={onClose}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !text.trim() || !when} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Agendar
          </button>
        </div>
      }
    >
      <WaDialogBody>
        <label className={waLabel}>Mensagem</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Texto a enviar…"
          className={`${waInput} mb-3 resize-none`} />
        <label className={waLabel}>Data e hora</label>
        <input type="datetime-local" value={when} min={minLocal} onChange={e => setWhen(e.target.value)}
          className={waInput} />
      </WaDialogBody>
    </WaDialog>
  );
};
