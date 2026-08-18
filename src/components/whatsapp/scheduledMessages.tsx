// Mensagens agendadas: bolhas-fantasma na thread + painel de gestão no aside.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { CalendarClock, Pencil, X, Loader2, Check, RotateCcw, Trash2, Wifi, AlertTriangle } from 'lucide-react';
import { whatsappService } from '../../services/whatsapp.service';
import { HISTORICO_AGENDADAS_DIAS } from '../../services/whatsapp/automation';
import { useToastContext } from '../../contexts/ToastContext';
import { conversationName, maskName, maskSensitive } from './format';
import { Avatar } from './avatar';
import { WaRichText } from './WaRichTextView';
import { waPlainText, stripAgentSignature } from './waRichText';
import type { ConfirmFn } from './types';
import type { WhatsAppScheduledMessage, WhatsAppScheduledWithContact } from '../../types/whatsapp.types';

// ── Bolhas-fantasma das mensagens agendadas dentro da thread ──
export const ThreadScheduledGhosts: React.FC<{ conversationId: string; privateMode: boolean; confirm: ConfirmFn }> = ({ conversationId, privateMode, confirm }) => {
  const toast = useToastContext();
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);
  // A lista vem PRONTA da fonte compartilhada — este componente e o painel
  // lateral mostram a mesma coisa e agora dividem um canal e uma consulta.
  const load = useCallback(() => {
    whatsappService.refreshScheduled(conversationId);
  }, [conversationId]);
  useEffect(() => {
    setItems(null);
    return whatsappService.subscribeScheduled(conversationId, setItems);
  }, [conversationId]);

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
              // Mesma leitura da bolha: sem a linha de assinatura e com as
              // marcas do WhatsApp viradas em estilo. O que espera na fila tem
              // que se parecer com o que o contato vai receber.
              s.body && (
                <WaRichText text={privateMode ? maskSensitive(s.body) : s.body} stripSignature
                  className="block text-[13px] text-slate-700 whitespace-pre-wrap break-words" />
              )
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
};

/**
 * Mensagens desta conversa que saíram de um agendamento: id da mensagem → o
 * horário para o qual ela estava marcada.
 *
 * Pega carona na MESMA fonte compartilhada das bolhas-fantasma e do painel
 * lateral (um canal e uma consulta por conversa), então a marca interna na
 * thread não custa nem mais uma assinatura nem mais uma ida ao banco.
 */
export function useScheduledSentMarks(conversationId: string | null): Map<string, string> {
  const [items, setItems] = useState<WhatsAppScheduledMessage[] | null>(null);
  useEffect(() => {
    setItems(null);
    if (!conversationId) return;
    return whatsappService.subscribeScheduled(conversationId, setItems);
  }, [conversationId]);

  return useMemo(() => {
    const marcas = new Map<string, string>();
    for (const s of items || []) {
      if (s.status === 'sent' && s.sent_message_id) marcas.set(s.sent_message_id, s.scheduled_at);
    }
    return marcas;
  }, [items]);
}

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

  // Mesma fonte compartilhada das bolhas-fantasma da thread: um canal e uma
  // consulta para os dois, em vez de um par para cada.
  const load = useCallback(() => {
    whatsappService.refreshScheduled(conversationId);
  }, [conversationId]);

  useEffect(() => {
    setItems(null);
    return whatsappService.subscribeScheduled(conversationId, setItems);
  }, [conversationId]);

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
                  {s.body && (
                    <WaRichText text={s.body} stripSignature
                      className="block mt-1 text-[12px] text-slate-600 whitespace-pre-wrap break-words line-clamp-3" />
                  )}
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

// ── Aba "Agendadas": tudo que EU agendei, em qualquer conversa ──
// O painel acima é por conversa. Esta lista responde a outra pergunta — "o que
// eu tenho na fila?" — e é o único lugar onde uma falha aparece sem que alguém
// precise adivinhar em qual conversa ela aconteceu.

/**
 * Ainda tem futuro: espera a hora de sair, espera o canal voltar, ou falhou e
 * precisa de alguém. O resto (enviada, cancelada) é história — não muda mais.
 */
export const isScheduledOpen = (s: WhatsAppScheduledMessage): boolean =>
  s.status === 'pending' || s.status === 'failed';

/** Conta as agendadas do atendente e quantas falharam. Alimenta o rótulo da aba. */
export function useMyScheduled(userId: string | undefined): {
  /** Tudo que voltou da consulta: fila + histórico. */
  items: WhatsAppScheduledWithContact[] | null;
  /** Só o que ainda vai acontecer — é este número que vale como "pendentes". */
  pending: WhatsAppScheduledWithContact[];
  failed: number;
  reload: () => void;
} {
  const [items, setItems] = useState<WhatsAppScheduledWithContact[] | null>(null);

  // A lista vem PRONTA da fonte compartilhada: o cartão do painel e a aba do
  // módulo aparecem juntos na tela e dividem um canal e uma consulta.
  const reload = useCallback(() => {
    if (userId) whatsappService.refreshMyScheduled(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) { setItems([]); return; }
    setItems(null);
    return whatsappService.subscribeMyScheduled(userId, setItems);
  }, [userId]);

  // Contadores olham só a fila: desde que o histórico passou a vir junto, somar
  // `items` faria o distintivo da aba crescer para sempre com o que já saiu.
  const pending = (items || []).filter(isScheduledOpen);
  const failed = pending.filter(s => s.status === 'failed').length;
  return { items, pending, failed, reload };
}

export const MyScheduledList: React.FC<{
  items: WhatsAppScheduledWithContact[] | null;
  privateMode: boolean;
  confirm: ConfirmFn;
  onReload: () => void;
  /**
   * Abre a conversa. `messageId` (quando existe) é a mensagem que o
   * agendamento virou: a thread deve parar NELA, não no fim da conversa.
   */
  onOpenConversation: (conversationId: string, messageId?: string | null) => void;
}> = ({ items, privateMode, confirm, onReload, onOpenConversation }) => {
  const toast = useToastContext();
  const [busy, setBusy] = useState<string | null>(null);
  const [aba, setAba] = useState<'pendentes' | 'concluidas'>('pendentes');

  const retryNow = async (id: string) => {
    setBusy(id);
    try { await whatsappService.retryScheduled(id); onReload(); toast.success('Reenviando agora.'); }
    catch (e: any) { toast.error('Falha ao reenviar', e.message); }
    finally { setBusy(null); }
  };

  const cancel = async (id: string) => {
    if (!await confirm({ title: 'Cancelar agendamento', message: 'A mensagem agendada não será enviada.', confirmLabel: 'Cancelar envio', tone: 'danger' })) return;
    try { await whatsappService.cancelScheduled(id); onReload(); }
    catch (e: any) { toast.error('Falha ao cancelar', e.message); }
  };

  const del = async (id: string) => {
    if (!await confirm({ title: 'Excluir agendamento', message: 'Remove a mensagem agendada do histórico. Não pode ser desfeito.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    try { await whatsappService.deleteScheduled(id); onReload(); }
    catch (e: any) { toast.error('Falha ao excluir', e.message); }
  };

  if (items === null) {
    return <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>;
  }

  // As duas metades da pergunta: "o que ainda vai sair?" e "o que já saiu?".
  // Juntas numa lista só, a segunda enterrava a primeira — e é a primeira que
  // ainda dá para mudar.
  const pendentes = items.filter(isScheduledOpen);
  const concluidas = items.filter(s => !isScheduledOpen(s));
  const failedCount = pendentes.filter(s => s.status === 'failed').length;
  // Abrir direto no histórico quando não há mais nada na fila poupa um clique de
  // quem veio justamente conferir se a mensagem de ontem saiu.
  const abaEfetiva = aba === 'pendentes' && pendentes.length === 0 && concluidas.length > 0 ? 'concluidas' : aba;
  const visiveis = abaEfetiva === 'pendentes' ? pendentes : concluidas;

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2 px-6 text-center">
        <CalendarClock size={30} className="text-slate-200" />
        <p className="text-[13px] text-slate-400">Nada agendado por você.</p>
        <p className="text-[11.5px] text-slate-300">Agende um follow-up pelo relógio ao lado do campo de mensagem.</p>
      </div>
    );
  }

  const iconBtn = 'p-1 rounded text-slate-300 transition';
  const abaCls = (ativa: boolean) => `flex-1 rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${
    ativa ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
  }`;

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-[#f0efea] bg-[#f7f6f3] px-3 py-2">
        <button onClick={() => setAba('pendentes')} className={abaCls(abaEfetiva === 'pendentes')}>
          Pendentes{pendentes.length > 0 ? ` (${pendentes.length})` : ''}
        </button>
        <button onClick={() => setAba('concluidas')} className={abaCls(abaEfetiva === 'concluidas')}>
          Concluídas{concluidas.length > 0 ? ` (${concluidas.length})` : ''}
        </button>
      </div>

      {failedCount > 0 && abaEfetiva === 'pendentes' && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-red-50 border-b border-red-100">
          <AlertTriangle size={15} className="text-red-600 flex-shrink-0 mt-px" />
          <p className="text-[12px] text-red-700 leading-snug">
            {failedCount === 1
              ? '1 mensagem não foi entregue. O cliente não recebeu.'
              : `${failedCount} mensagens não foram entregues. Os clientes não receberam.`}
          </p>
        </div>
      )}

      {visiveis.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <CalendarClock size={30} className="text-slate-200" />
          <p className="text-[13px] text-slate-400">
            {abaEfetiva === 'pendentes' ? 'Nada na fila agora.' : 'Nada concluído ainda.'}
          </p>
          <p className="text-[11.5px] text-slate-300">
            {abaEfetiva === 'pendentes'
              ? 'Tudo que você agendou já saiu ou foi cancelado.'
              : `Aqui fica o que foi enviado ou cancelado nos últimos ${HISTORICO_AGENDADAS_DIAS} dias.`}
          </p>
        </div>
      )}

      <div className="divide-y divide-[#f0efea]">
        {visiveis.map(s => {
          const st = schedBadge(s);
          const failed = s.status === 'failed';
          // Mesmo nome que a inbox mostra: cadastro na frente do apelido do WhatsApp.
          const fullName = conversationName(s);
          const name = privateMode ? maskName(fullName) : fullName;
          return (
            <div key={s.id} className={`flex gap-3 px-4 py-3 ${failed ? 'bg-red-50/40' : ''}`}>
              {/* A LINHA INTEIRA abre a conversa — só os ícones de ação ficam
                  de fora. Antes só a foto e o nome levavam para lá, e o alvo
                  útil de uma lista de conferência é a linha, não dois pedaços
                  dela. Quando a mensagem já saiu e sabemos qual ela é, a thread
                  para exatamente nela (ver `sent_message_id`); sem esse elo, o
                  clique continua fazendo o que sempre fez: abrir a conversa. */}
              <button
                onClick={() => onOpenConversation(s.conversation_id, s.sent_message_id ?? null)}
                title={s.sent_message_id ? 'Ir até a mensagem na conversa' : 'Abrir a conversa'}
                className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left transition hover:bg-amber-50/60">
                <span className="flex-shrink-0">
                  <Avatar url={privateMode ? null : s.contact_avatar_url} name={name} phone={s.contact_phone} size={36} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-slate-800 truncate">{name}</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.cls}`}>
                      {isReconnectHold(s) && <Wifi size={10} className="opacity-70" />}{st.label}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {new Date(s.scheduled_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </span>

                  {/* Prévia de UMA LINHA, em texto puro: as marcas do WhatsApp
                      viram ruído numa linha truncada, e um link de verdade não
                      pode existir aqui dentro — a linha inteira já é um botão,
                      e âncora dentro de botão é HTML inválido. */}
                  {s.body && (
                    <span className="mt-0.5 block truncate text-[11.5px] text-slate-500">
                      {waPlainText(stripAgentSignature(privateMode ? maskSensitive(s.body) : s.body))}
                    </span>
                  )}
                  {isReconnectHold(s) && (
                    <span className="mt-0.5 block text-[11px] text-sky-600">Retida porque o canal está fora. Sai sozinha quando reconectar.</span>
                  )}
                  {failed && (
                    <span className="mt-0.5 block text-[11px] text-red-600">{s.error || 'O envio falhou. Nenhuma nova tentativa automática.'}</span>
                  )}
                </span>
              </button>

              <div className="flex items-start gap-0.5 flex-shrink-0">
                {failed && (
                  <button onClick={() => retryNow(s.id)} disabled={busy === s.id} title="Tentar enviar agora"
                    className={`${iconBtn} text-red-400 hover:text-emerald-600`}>
                    {busy === s.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                )}
                {s.status === 'pending' && (
                  <button onClick={() => cancel(s.id)} title="Cancelar agendamento" className={`${iconBtn} hover:text-amber-600`}>
                    <X size={14} />
                  </button>
                )}
                <button onClick={() => del(s.id)} title="Excluir" className={`${iconBtn} hover:text-rose-500`}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* O histórico é uma janela, não um arquivo. Dizer isso em uma linha evita
          a leitura errada de que uma agendada antiga "sumiu": ela continua no
          banco — é a lista que só olha para trás até onde ainda é útil. */}
      {abaEfetiva === 'concluidas' && concluidas.length > 0 && (
        <p className="px-4 py-3 text-center text-[11px] text-slate-400">
          Histórico dos últimos {HISTORICO_AGENDADAS_DIAS} dias.
        </p>
      )}
    </div>
  );
};
