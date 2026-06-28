// Notas internas da conversa (só a equipe vê): painel compacto + modal de histórico.
import React, { useState, useEffect, useCallback } from 'react';
import { StickyNote, Maximize2, Loader2, Plus, Trash2 } from 'lucide-react';
import { whatsappService, type WhatsAppInternalNote } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { fmtNoteDate } from './format';
import { Modal, ModalBody } from '../ui/Modal';
import type { ConfirmFn } from './types';

export const InternalNotesPanel: React.FC<{
  conversationId: string;
  staffByUser: Map<string, string>;
  currentUserId: string | null;
  confirm: ConfirmFn;
  embedded?: boolean;
  limit?: number;
  onExpand?: () => void;
}> = ({ conversationId, staffByUser, currentUserId, confirm, embedded, limit, onExpand }) => {
  const toast = useToastContext();
  const [notes, setNotes] = useState<WhatsAppInternalNote[] | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Painel "Notas internas" = só notas MANUAIS da equipe. Oculta lançamentos
  // automáticos: IA/cron inserem sem autor (author_id null); trilha de "Documentos
  // solicitados"; e notas legadas de navegação de módulo. O histórico completo desses
  // eventos continua disponível na Timeline.
  const isAutomatic = (n: WhatsAppInternalNote) => {
    if (!n.author_id) return true;
    const b = n.body.trim();
    return /^📄\s*Documentos?\s+solicitad/i.test(b)
      || /abert[oa] a partir desta conversa|m[óo]dulo .* abert|iniciada desta conversa/i.test(b);
  };
  const visibleNotes = notes?.filter(n => !isAutomatic(n)) ?? null;

  const load = useCallback(() => {
    whatsappService.listNotes(conversationId).then(setNotes).catch(() => setNotes([]));
  }, [conversationId]);
  useEffect(() => { setNotes(null); load(); }, [conversationId, load]);

  const add = async () => {
    const body = draft.trim();
    if (!body) return;
    setSaving(true);
    try { await whatsappService.addNote(conversationId, body); setDraft(''); load(); }
    catch (e: any) { toast.error('Falha ao salvar nota', e.message); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!await confirm({ title: 'Excluir nota', message: 'Esta nota interna será removida.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.deleteNote(id); setNotes(n => (n || []).filter(x => x.id !== id)); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };

  return (
    <div className="space-y-2">
      {!embedded && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <StickyNote size={12} /> Notas internas{(visibleNotes?.length ?? 0) > 0 ? ` (${visibleNotes!.length})` : ''}
          </p>
          {onExpand && (
            <button onClick={onExpand} title="Abrir em tela cheia"
              className="p-0.5 rounded text-slate-300 hover:text-amber-600 transition"><Maximize2 size={12} /></button>
          )}
        </div>
      )}
      <p className="text-[10.5px] text-slate-400 -mt-1">Só a equipe vê — não vai para o cliente.</p>
      <div className="flex items-start gap-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
          placeholder="Anote algo para a equipe…"
          className="flex-1 resize-none px-2.5 py-2 text-[12.5px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
        <button onClick={add} disabled={saving || !draft.trim()} title="Adicionar nota (Ctrl+Enter)"
          className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-600 text-white flex items-center justify-center hover:bg-amber-700 disabled:opacity-50">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={16} />}
        </button>
      </div>
      {notes === null ? (
        <div className="flex items-center gap-2 text-slate-400 text-[12px] py-1"><Loader2 size={13} className="animate-spin" /> Carregando…</div>
      ) : (visibleNotes ?? []).length === 0 ? (
        <p className="text-[11.5px] text-slate-400">Nenhuma nota ainda.</p>
      ) : (() => {
        const all = visibleNotes ?? [];
        const shown = limit ? all.slice(0, limit) : all;
        const hidden = all.length - shown.length;
        return (
          <div className="space-y-1.5">
            {shown.map(n => (
              <div key={n.id} className="rounded-lg border border-amber-100 bg-amber-50/50 px-2.5 py-2 group">
                <p className="text-[12.5px] text-slate-700 whitespace-pre-wrap break-words">{n.body}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10.5px] text-slate-400">
                    {(n.author_id && staffByUser.get(n.author_id)) || 'Equipe'} · {fmtNoteDate(n.created_at)}
                  </span>
                  {n.author_id === currentUserId && (
                    <button onClick={() => remove(n.id)} title="Excluir nota"
                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><Trash2 size={12} /></button>
                  )}
                </div>
              </div>
            ))}
            {hidden > 0 && (
              <button onClick={onExpand}
                className="w-full text-center py-1.5 text-[11.5px] font-semibold text-amber-600 hover:text-amber-700">
                Ver todas ({all.length}) →
              </button>
            )}
          </div>
        );
      })()}
    </div>
  );
};

// Sidebar: mostra só as notas recentes (compacto) e abre o histórico completo em
// modal — evita poluir a coluna lateral quando há muitas notas automáticas da IA.
export const InternalNotesSection: React.FC<{
  conversationId: string;
  staffByUser: Map<string, string>;
  currentUserId: string | null;
  confirm: ConfirmFn;
}> = (props) => {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(0); // remonta o painel compacto ao fechar o modal (recarrega)
  return (
    <>
      <InternalNotesPanel key={v} {...props} limit={3} onExpand={() => setOpen(true)} />
      <Modal open={open} onClose={() => { setOpen(false); setV(x => x + 1); }} size="lg"
        title="Notas internas" icon={<StickyNote size={18} />}>
        <ModalBody>
          <InternalNotesPanel {...props} embedded />
        </ModalBody>
      </Modal>
    </>
  );
};
