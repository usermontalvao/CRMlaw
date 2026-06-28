// Mensagens agendadas: bolhas-fantasma na thread + painel de gestão no aside.
import React, { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Pencil, X, Loader2, Check, RotateCcw, Trash2, Wifi } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { maskSensitive } from './format';
import type { ConfirmFn } from './types';
import type { WhatsAppScheduledMessage } from '../../types/whatsapp.types';

// ── Bolhas-fantasma das mensagens agendadas dentro da thread ──
export const ThreadScheduledGhosts: React.FC<{ conversationId: string; privateMode: boolean; confirm: ConfirmFn }> = ({ conversationId, privateMode, confirm }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);
  const load = useCallback(() => {
    whatsappService.listScheduled(conversationId).then(setItems).catch(() => setItems([]));
  }, [conversationId]);
  useEffect(() => {
    setItems(null);
    load();
    const unsub = whatsappService.subscribeScheduled(conversationId, load);
    return () => unsub();
  }, [conversationId, load]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [busy, setBusy] = useState(false);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const startEdit = (s: WhatsAppScheduledMessage) => { setEditingId(s.id); setEditText(s.body || ''); setEditWhen(toLocalInput(s.scheduled_at)); };
  const removeScheduled = async (id: string) => {
    if (!await confirm({ title: 'Excluir agendamento', message: 'A mensagem agendada não será enviada.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.cancelScheduled(id); load(); toast.success('Agendamento excluído.'); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditWhen(''); };
  const saveEdit = async (id: string) => {
    if (!editWhen) return;
    setBusy(true);
    try {
      await whatsappService.updateScheduled(id, { text: editText, scheduledAt: new Date(editWhen).toISOString() });
      cancelEdit(); load();
    } catch (e: any) { toast.error('Falha ao salvar', e.message); }
    finally { setBusy(false); }
  };

  const pending = (items || []).filter(s => s.status === 'pending');
  if (pending.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-2">
      {pending.map(s => {
        const editing = editingId === s.id;
        const reconnectHold = s.hold_reason === 'reconnect';
        return (
        <div key={s.id} className="flex justify-end">
          <div className={`group max-w-[75%] rounded-2xl rounded-br-sm border border-dashed px-3 py-2 ${reconnectHold ? 'border-sky-300 bg-sky-50/60' : 'border-amber-300 bg-amber-50/60'}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              {reconnectHold
                ? <Wifi size={12} className="text-sky-600" />
                : <CalendarClock size={12} className="text-amber-600" />}
              <span className={`text-[10px] font-bold uppercase tracking-wide ${reconnectHold ? 'text-sky-700' : 'text-amber-700'}`}>
                {reconnectHold ? 'Aguardando reconexão' : 'Agendada'}
              </span>
              {!reconnectHold && (
                <span className="text-[10px] text-slate-400">
                  {new Date(s.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              {!editing && (
                <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => startEdit(s)} title="Editar agendamento"
                    className="p-0.5 rounded text-amber-400 hover:text-amber-600 transition">
                    <Pencil size={12} />
                  </button>
                  <button onClick={() => removeScheduled(s.id)} title="Excluir agendamento"
                    className="p-0.5 rounded text-amber-400 hover:text-red-600 transition">
                    <X size={13} strokeWidth={2.5} />
                  </button>
                </span>
              )}
            </div>
            {editing ? (
              <div className="mt-1 space-y-1.5">
                <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                  className="w-full px-2.5 py-1.5 text-[12.5px] rounded-lg bg-white border border-amber-200 focus:border-amber-400 outline-none resize-none" />
                <input type="datetime-local" value={editWhen} onChange={e => setEditWhen(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-white border border-amber-200 focus:border-amber-400 outline-none" />
                <div className="flex justify-end gap-1.5">
                  <button onClick={cancelEdit} className="px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
                  <button onClick={() => saveEdit(s.id)} disabled={busy || !editWhen}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Salvar
                  </button>
                </div>
              </div>
            ) : (
              s.body && <p className="text-[13px] text-slate-700 whitespace-pre-wrap break-words">{privateMode ? maskSensitive(s.body) : s.body}</p>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
};

// ── Painel de mensagens agendadas no aside (Fase 8.1) ──
const SCHED_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Agendada', cls: 'bg-amber-100 text-amber-700' },
  sent: { label: 'Enviada', cls: 'bg-emerald-100 text-emerald-700' },
  canceled: { label: 'Cancelada', cls: 'bg-slate-100 text-slate-500' },
  failed: { label: 'Falha', cls: 'bg-red-100 text-red-600' },
};

// Retenção automática por reconexão tem aparência própria (não é "agendada pelo
// usuário"): a mensagem não saiu porque o canal está fora e será reenviada sozinha.
const isReconnectHold = (s: WhatsAppScheduledMessage) => s.status === 'pending' && s.hold_reason === 'reconnect';
const schedBadge = (s: WhatsAppScheduledMessage): { label: string; cls: string } =>
  isReconnectHold(s)
    ? { label: 'Aguardando reconexão', cls: 'bg-sky-100 text-sky-700' }
    : (SCHED_STATUS[s.status] || { label: s.status, cls: 'bg-slate-100 text-slate-500' });
export const ScheduledMessagesPanel: React.FC<{ conversationId: string; canSchedule: boolean; confirm: ConfirmFn }> = ({ conversationId, confirm }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);

  const load = useCallback(() => {
    whatsappService.listScheduled(conversationId).then(setItems).catch(() => setItems([]));
  }, [conversationId]);

  useEffect(() => {
    setItems(null);
    load();
    const unsub = whatsappService.subscribeScheduled(conversationId, load);
    return () => unsub();
  }, [conversationId, load]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editWhen, setEditWhen] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const toLocalInput = (iso: string) => {
    const d = new Date(iso); const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startEdit = (s: WhatsAppScheduledMessage) => {
    setEditingId(s.id); setEditText(s.body || ''); setEditWhen(toLocalInput(s.scheduled_at));
  };
  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditWhen(''); };

  const saveEdit = async (s: WhatsAppScheduledMessage) => {
    if (!editWhen) return;
    setBusy(s.id);
    try {
      const scheduledAt = new Date(editWhen).toISOString();
      if (s.status === 'pending') {
        await whatsappService.updateScheduled(s.id, { text: editText, scheduledAt });
      } else {
        // Falhou/cancelada → reagenda voltando para 'pending'.
        await whatsappService.retryScheduled(s.id, { text: editText, scheduledAt });
      }
      cancelEdit(); load();
    } catch (e: any) { toast.error('Falha ao salvar', e.message); }
    finally { setBusy(null); }
  };

  const cancel = async (id: string) => {
    if (!await confirm({ title: 'Cancelar agendamento', message: 'A mensagem agendada não será enviada.', confirmLabel: 'Cancelar envio', tone: 'danger' })) return;
    try { await whatsappService.cancelScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao cancelar', e.message); }
  };

  const del = async (id: string) => {
    if (!await confirm({ title: 'Excluir agendamento', message: 'Remove a mensagem agendada do histórico. Não pode ser desfeito.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.deleteScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };

  const retryNow = async (id: string) => {
    setBusy(id);
    try { await whatsappService.retryScheduled(id); load(); }
    catch (e: any) { toast.error('Falha ao reenviar', e.message); }
    finally { setBusy(null); }
  };

  // Mensagens já enviadas não interessam aqui — viram histórico na thread.
  const visible = (items || []).filter(s => s.status !== 'sent');

  // Sem nada pendente/falho/cancelado → não ocupa espaço.
  if (visible.length === 0) return null;

  const iconBtn = 'p-1 rounded text-slate-300 transition';
  return (
    <div className="space-y-2">
      <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        <CalendarClock size={12} /> Mensagens agendadas
      </p>
      <div className="space-y-1.5">
        {visible.map(s => {
          const st = schedBadge(s);
          const reconnectHold = isReconnectHold(s);
          const editing = editingId === s.id;
          return (
            <div key={s.id} className="rounded-lg border border-[#e7e5df] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>
                  {reconnectHold && <Wifi size={10} className="opacity-70" />}{st.label}
                </span>
                <span className="text-[10.5px] text-slate-400 flex-1">
                  {new Date(s.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
                {!editing && (
                  <span className="flex items-center gap-0.5">
                    {(s.status === 'pending' || s.status === 'failed' || s.status === 'canceled') && (
                      <button onClick={() => startEdit(s)} title={s.status === 'pending' ? 'Editar' : 'Editar e reagendar'} className={`${iconBtn} hover:text-amber-600`}><Pencil size={13} /></button>
                    )}
                    {s.status === 'failed' && (
                      <button onClick={() => retryNow(s.id)} disabled={busy === s.id} title="Tentar enviar agora" className={`${iconBtn} hover:text-emerald-600`}>
                        {busy === s.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                      </button>
                    )}
                    {s.status === 'pending' && (
                      <button onClick={() => cancel(s.id)} title="Cancelar agendamento" className={`${iconBtn} hover:text-amber-600`}><X size={13} /></button>
                    )}
                    <button onClick={() => del(s.id)} title="Excluir" className={`${iconBtn} hover:text-rose-500`}><Trash2 size={13} /></button>
                  </span>
                )}
              </div>

              {editing ? (
                <div className="mt-2 space-y-1.5">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none resize-none" />
                  <input type="datetime-local" value={editWhen} onChange={e => setEditWhen(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[12px] rounded-lg bg-[#f3f2ef] border border-transparent focus:bg-white focus:border-amber-300 outline-none" />
                  <div className="flex justify-end gap-1.5">
                    <button onClick={cancelEdit} className="px-2.5 py-1 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700">Cancelar</button>
                    <button onClick={() => saveEdit(s)} disabled={busy === s.id || !editWhen}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[11.5px] font-semibold hover:bg-amber-700 disabled:opacity-50">
                      {busy === s.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {s.status === 'pending' ? 'Salvar' : 'Reagendar'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {s.body && <p className="mt-1 text-[12px] text-slate-600 whitespace-pre-wrap break-words line-clamp-3">{s.body}</p>}
                  {reconnectHold && <p className="mt-0.5 text-[10.5px] text-sky-600">Retida porque o canal está fora. Será enviada automaticamente quando reconectar.</p>}
                  {s.status === 'failed' && s.error && <p className="mt-0.5 text-[10.5px] text-red-500">{s.error}</p>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
