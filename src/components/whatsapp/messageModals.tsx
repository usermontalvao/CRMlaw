// Modais ligados à composição de mensagens: seletor de modelos/macros e
// agendamento de mensagem. Extraídos de WhatsAppModule.tsx — autocontidos.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, CalendarClock, Plus, Loader2, Trash2, Pencil, Save, X } from 'lucide-react';
import {
  WaDialog, WaDialogBody, WaDialogActions, WaField, WaFieldStack,
  waInput, waTextarea, waBtnGhost, waBtnPrimary,
} from './ui';
import { whatsappService, renderTemplate } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import type { WhatsAppTemplate } from '../../types/whatsapp.types';
import type { WhatsAppConversation } from '../../types/whatsapp.types';
import { matchesNormalizedSearch } from '../../utils/search';

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBody, setEditBody] = useState('');

  const load = useCallback(() => {
    whatsappService.listTemplates({ activeOnly: true })
      .then(setTemplates).catch(() => setTemplates([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = (templates || []).filter(t =>
    !q.trim() || matchesNormalizedSearch(q, [t.name, t.category]));

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

  const startEdit = (t: WhatsAppTemplate) => {
    setEditingId(t.id);
    setEditName(t.name);
    setEditBody(t.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditBody('');
  };

  const saveEdit = async (t: WhatsAppTemplate) => {
    if (!editName.trim() || !editBody.trim()) return;
    setSaving(true);
    try {
      await whatsappService.updateTemplate(t.id, { name: editName.trim(), body: editBody.trim() });
      toast.success('Modelo atualizado.');
      cancelEdit();
      load();
    } catch (e: any) { toast.error('Falha ao atualizar modelo', e.message); }
    finally { setSaving(false); }
  };

  return (
    <WaDialog title="Modelos de mensagem" subtitle="Digite / no compositor para usar um atalho"
      icon={<MessageSquare size={18} />} onClose={onClose}
      headerActions={
        <button onClick={() => setCreating(c => !c)} title="Novo modelo"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-700 transition hover:bg-amber-100">
          <Plus size={13} /> Novo
        </button>
      }>
      {/* Formulário de novo modelo */}
      {creating && (
        <div className="border-b border-[#efece5] bg-[#faf9f7] px-4 py-4 sm:px-5">
          <WaFieldStack>
            <WaField label="Atalho / título" optional="(ex: boas-vindas → digite /boas)" htmlFor="wa-tpl-name">
              <input id="wa-tpl-name" autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="boas-vindas" className={waInput} />
            </WaField>
            <WaField label="Texto da mensagem" htmlFor="wa-tpl-body"
              hint={<>Variáveis: {'{{cliente.nome}}'}, {'{{saudacao}}'}, {'{{agente.nome}}'}.</>}>
              <textarea id="wa-tpl-body" value={newBody} onChange={e => setNewBody(e.target.value)} rows={3}
                placeholder="Olá! Seja bem-vindo(a) ao nosso escritório…" className={waTextarea} />
            </WaField>
            <WaDialogActions>
              <button onClick={() => { setCreating(false); setNewName(''); setNewBody(''); }} className={waBtnGhost}>Cancelar</button>
              <button onClick={createNew} disabled={saving || !newName.trim() || !newBody.trim()} className={waBtnPrimary}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Salvar modelo
              </button>
            </WaDialogActions>
          </WaFieldStack>
        </div>
      )}

      <div className="border-b border-[#efece5] px-4 py-3 sm:px-5">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar modelo…" className={waInput} />
      </div>
      <div className="space-y-2 px-4 py-3 sm:px-5">
        {templates === null ? (
          <div className="flex items-center justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[13px] text-slate-400 py-6">Nenhum modelo. Clique em <strong>Novo</strong> para cadastrar.</p>
        ) : filtered.map(t => {
          const preview = renderTemplate(t.body, context);
          return (
            <div key={t.id}
              className="group/tpl relative rounded-xl border border-[#e7e5df] transition hover:border-amber-300 hover:bg-amber-50/40">
              {editingId === t.id ? (
                <div className="p-3">
                  <WaFieldStack>
                    <WaField label="Atalho / título">
                      <input value={editName} onChange={e => setEditName(e.target.value)} className={waInput} />
                    </WaField>
                    <WaField label="Texto da mensagem">
                      <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={4} className={waTextarea} />
                    </WaField>
                    <WaDialogActions>
                      <button onClick={cancelEdit} className={waBtnGhost}><X size={14} /> Cancelar</button>
                      <button onClick={() => saveEdit(t)} disabled={saving || !editName.trim() || !editBody.trim()} className={waBtnPrimary}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar
                      </button>
                    </WaDialogActions>
                  </WaFieldStack>
                </div>
              ) : (
                <>
                  <button onClick={() => onPick(preview)} className="w-full text-left p-3 pr-16">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-700">
                        <span className="text-amber-600">/</span>{t.name}
                      </span>
                      {t.category && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500">{t.category}</span>}
                    </div>
                    <p className="text-[12px] text-slate-500 line-clamp-3 whitespace-pre-wrap break-words">{preview}</p>
                  </button>
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover/tpl:opacity-100 transition">
                    <button onClick={() => startEdit(t)} title="Editar modelo"
                      className="p-1.5 rounded-lg text-slate-300 hover:text-slate-700 hover:bg-slate-100 transition">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => remove(t)} disabled={deletingId === t.id} title="Excluir modelo"
                      className="p-1.5 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition disabled:opacity-50">
                      {deletingId === t.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </>
              )}
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
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Quem abre "Agendar mensagem" vem para escrever: o cursor já nasce no campo
  // da mensagem, e depois do rascunho que veio do compositor — não antes dele.
  // Roda depois do foco inicial do WaDialog (efeito do filho vem primeiro).
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

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
        <WaDialogActions>
          <button onClick={onClose} className={waBtnGhost}>Cancelar</button>
          <button onClick={submit} disabled={saving || !text.trim() || !when} className={waBtnPrimary}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />} Agendar
          </button>
        </WaDialogActions>
      }
    >
      <WaDialogBody>
        <WaFieldStack>
          <WaField label="Mensagem" htmlFor="wa-sched-text">
            <textarea ref={textRef} id="wa-sched-text" value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="Texto a enviar…" className={waTextarea} />
          </WaField>
          <WaField label="Data e hora" htmlFor="wa-sched-when" hint="Precisa ser pelo menos 1 minuto no futuro.">
            <input id="wa-sched-when" type="datetime-local" value={when} min={minLocal}
              onChange={e => setWhen(e.target.value)} className={waInput} />
          </WaField>
        </WaFieldStack>
      </WaDialogBody>
    </WaDialog>
  );
};
