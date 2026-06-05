/**
 * PortalChatWidget — Widget flutuante de chat para o Portal do Cliente.
 */
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Briefcase, Calendar, ChevronDown, FileText,
  Loader2, MessageCircle, Paperclip, PenTool,
  PiggyBank, Plus, Send, X,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePortalRouter } from '../hooks/usePortalRouter';
import { clientPortalService } from '../services/clientPortal.service';
import { supabasePortal } from '../lib/supabasePortal';
import type { PortalChatMessage } from '../../types/chat.types';

const PORTAL_CHAT_VISIBLE_KEY = 'portal-chat-visible';
const PORTAL_CHAT_VISIBLE_EVENT = 'crm:portal_chat_visible';

// ─── tipos ────────────────────────────────────────────────────────────────────

interface AttendantInfo {
  name: string;
  role?: string | null;
  avatar_url?: string | null;
  presence_status?: string | null;
}

interface Shortcut {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  message: string;
  bg: string;
  fg: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const ATTACH = '__anexo__:';

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dLabel(iso: string) {
  const d = new Date(iso), today = new Date(), yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yest.toDateString())  return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function groupByDay(msgs: PortalChatMessage[]) {
  const out: { label: string; msgs: PortalChatMessage[] }[] = [];
  let last = '';
  for (const m of msgs) {
    const l = dLabel(m.created_at);
    if (l !== last) { out.push({ label: l, msgs: [] }); last = l; }
    out[out.length - 1].msgs.push(m);
  }
  return out;
}

function initials(n: string) {
  return n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function parseAttach(c: string) {
  if (!c.startsWith(ATTACH)) return null;
  try { return JSON.parse(c.slice(ATTACH.length)) as { fileName: string; mimeType: string }; }
  catch { return null; }
}

// ─── TypingDots ───────────────────────────────────────────────────────────────

const Dots = () => (
  <div className="flex gap-[3px] px-3 py-2.5">
    {[0,1,2].map(i => (
      <span key={i} className="h-1.5 w-1.5 rounded-full bg-slate-400"
        style={{ animation: `wDot 1s ${i*0.2}s infinite` }} />
    ))}
  </div>
);

// ─── Bolha de mensagem ────────────────────────────────────────────────────────

const Bubble: React.FC<{ msg: PortalChatMessage }> = ({ msg }) => {
  const attach = parseAttach(msg.content);
  const isClient = msg.from_client;
  const body = attach
    ? <span className="flex items-center gap-1.5 text-[12px]"><Paperclip className="h-3.5 w-3.5 shrink-0 opacity-70" /><span className="truncate max-w-[150px]">{attach.fileName}</span></span>
    : <span className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">{msg.content}</span>;

  return (
    <div className={`flex mb-1 ${isClient ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] flex flex-col ${isClient ? 'items-end' : 'items-start'}`}>
        {!isClient && msg.sender_name && (
          <span className="mb-0.5 ml-1 text-[10px] font-semibold text-orange-500">{msg.sender_name}</span>
        )}
        <div className={`rounded-[14px] px-3 py-2 shadow-sm ${
          isClient
            ? 'rounded-br-[4px] bg-orange-500 text-white'
            : 'rounded-bl-[4px] bg-white text-slate-800 ring-1 ring-slate-100'
        }`}>
          {body}
        </div>
        <span className={`mt-0.5 text-[10px] text-slate-400 ${isClient ? 'mr-1' : 'ml-1'}`}>
          {hhmm(msg.created_at)}
        </span>
      </div>
    </div>
  );
};

// ─── componente principal ─────────────────────────────────────────────────────

export const PortalChatWidget: React.FC = () => {
  const { session }  = useClientAuth();
  const { route }    = usePortalRouter();
  const isMobile     = useIsMobile();

  const [open, setOpen]             = useState(false);
  const [msgs, setMsgs]             = useState<PortalChatMessage[]>([]);
  const [roomId, setRoomId]         = useState<string | null>(null);
  const [closed, setClosed]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [text, setText]             = useState('');
  const [sending, setSending]       = useState(false);
  const [starting, setStarting]     = useState(false);
  const [attendant, setAttendant]   = useState<AttendantInfo | null>(null);
  const [attTyping, setAttTyping]   = useState(false);
  const [unread, setUnread]         = useState(0);
  const [loaded, setLoaded]         = useState(false);
  const [shortcuts, setShortcuts]   = useState<Shortcut[]>([]);
  const [loadingSC, setLoadingSC]   = useState(false);

  const bottomRef   = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const roomIdRef   = useRef<string | null>(null);
  const openRef     = useRef(false);
  const chatCh      = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typingCh    = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const attTypCh    = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attTypTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks temp UUIDs of optimistic messages still in-flight (RPC not returned yet).
  // Used by the realtime handler to replace the optimistic entry instead of adding a duplicate.
  const inflightTids = useRef<Set<string>>(new Set());

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);
  useEffect(() => { openRef.current = open; }, [open]);

  useEffect(() => {
    const visible = !!session && (open || route === 'mensagens');
    try {
      localStorage.setItem(PORTAL_CHAT_VISIBLE_KEY, visible ? '1' : '0');
    } catch {}
    window.dispatchEvent(new CustomEvent(PORTAL_CHAT_VISIBLE_EVENT, {
      detail: { visible, route },
    }));
  }, [open, route, session]);

  // Ocultar na página de mensagens

  // ── posição dinâmica ──────────────────────────────────────────────────────
  // Mobile: acima da nav bar (≈84px + safe-area)
  // Desktop: fixo 24px do rodapé da tela
  const btnBottom  = isMobile ? 'calc(84px + env(safe-area-inset-bottom,0px))' : '24px';
  const popBottom  = isMobile ? 'calc(148px + env(safe-area-inset-bottom,0px))' : '88px';
  const popWidth   = 'min(320px, calc(100vw - 24px))';
  const popHeight  = isMobile
    ? 'min(500px, calc(100dvh - 200px))'
    : 'min(480px, calc(100vh - 120px))';

  // ── scroll ─────────────────────────────────────────────────────────────────
  const scrollBottom = useCallback((b: ScrollBehavior = 'smooth') => {
    const run = () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: b });
        return;
      }
      bottomRef.current?.scrollIntoView({ behavior: b, block: 'end' });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }, []);

  // ── loadMessages ───────────────────────────────────────────────────────────
  const loadMessages = useCallback(async (showLoader = false) => {
    if (!session?.user?.id) return;
    if (showLoader) setLoading(true);
    const prev = roomIdRef.current;
    try {
      const data = await clientPortalService.getChatMessages(session.user.id);
      if (!data) return;
      const newRoom   = data.room?.id ?? null;
      const newClosed = !!(data.room as any)?.is_closed;
      const changed   = !prev || prev !== newRoom;

      setMsgs(cur => {
        const incoming = (data.messages ?? []).filter((m: PortalChatMessage) => m.content?.trim());
        if (changed) return incoming;
        const sids = new Set(incoming.map((m: PortalChatMessage) => m.id));
        const local = cur.filter(m => !sids.has(m.id));
        return [...incoming, ...local].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

      if (roomIdRef.current !== newRoom) { roomIdRef.current = newRoom; setRoomId(newRoom); }
      setClosed(newClosed);
      setAttendant((data as any).attendant ?? null);
      setLoaded(true);
      if (changed) setTimeout(() => scrollBottom('auto'), 80);
    } finally { if (showLoader) setLoading(false); }
  }, [session?.user?.id, scrollBottom]);

  // ── loadShortcuts ──────────────────────────────────────────────────────────
  const loadShortcuts = useCallback(async () => {
    if (!session?.user?.id || shortcuts.length > 0) return;
    setLoadingSC(true);
    try {
      const s = await clientPortalService.getDashboardSummary(session.user.id);
      const list: Shortcut[] = [];

      const procs = (s as any)?.active_processes as any[];
      if (Array.isArray(procs) && procs.length > 0) {
        const p = procs[0];
        const t = String(p?.title ?? p?.number ?? 'meu processo');
        list.push({ icon: <Briefcase className="h-4 w-4" />, label: 'Processo', sub: t.length > 34 ? t.slice(0,34)+'…' : t, message: `Tenho uma dúvida sobre o processo: ${t}`, bg: 'bg-blue-50', fg: 'text-blue-600' });
      }

      const reqs = (s as any)?.pending_requirements as any[];
      if (Array.isArray(reqs) && reqs.length > 0) {
        list.push({ icon: <FileText className="h-4 w-4" />, label: 'Documentos pendentes', sub: `${reqs.length} item${reqs.length>1?'s':''} aguardando`, message: 'Preciso de ajuda com o envio de documentos pendentes', bg: 'bg-amber-50', fg: 'text-amber-600' });
      }

      const agrs = (s as any)?.agreements_summary;
      if ((agrs as any)?.overdue > 0 || (agrs as any)?.upcoming > 0) {
        const amt = (agrs as any)?.overdue_amount;
        list.push({ icon: <PiggyBank className="h-4 w-4" />, label: 'Financeiro', sub: amt ? `R$ ${Number(amt).toLocaleString('pt-BR',{minimumFractionDigits:2})} em aberto` : 'Parcelas pendentes', message: 'Tenho uma dúvida sobre meus pagamentos', bg: 'bg-rose-50', fg: 'text-rose-600' });
      }

      const sigs = (s as any)?.signatures_pending as number;
      if (sigs > 0) list.push({ icon: <PenTool className="h-4 w-4" />, label: 'Assinaturas pendentes', sub: `${sigs} doc${sigs>1?'s':''} para assinar`, message: 'Preciso de ajuda com as assinaturas pendentes', bg: 'bg-violet-50', fg: 'text-violet-600' });

      const nd = (s as any)?.next_deadline;
      if (nd) list.push({ icon: <Calendar className="h-4 w-4" />, label: 'Prazo próximo', sub: String(nd), message: 'Tenho uma dúvida sobre o prazo do meu processo', bg: 'bg-emerald-50', fg: 'text-emerald-600' });

      if (list.length === 0) {
        list.push(
          { icon: <Briefcase className="h-4 w-4" />, label: 'Andamento do processo', sub: undefined, message: 'Quero saber sobre o andamento do meu processo', bg: 'bg-blue-50', fg: 'text-blue-600' },
          { icon: <FileText className="h-4 w-4" />, label: 'Enviar documentos', sub: undefined, message: 'Preciso enviar documentos para o escritório', bg: 'bg-amber-50', fg: 'text-amber-600' },
          { icon: <PiggyBank className="h-4 w-4" />, label: 'Informações financeiras', sub: undefined, message: 'Tenho uma dúvida sobre meus pagamentos', bg: 'bg-rose-50', fg: 'text-rose-600' },
          { icon: <PenTool className="h-4 w-4" />, label: 'Assinar documento', sub: undefined, message: 'Preciso assinar um documento', bg: 'bg-violet-50', fg: 'text-violet-600' },
        );
      }
      setShortcuts(list);
    } finally { setLoadingSC(false); }
  }, [session?.user?.id, shortcuts.length]);

  // ── ao abrir ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !session) return;
    if (!loaded) void loadMessages(true);
    void loadShortcuts();
    setUnread(0);
    setTimeout(() => scrollBottom('auto'), 120);
    setTimeout(() => inputRef.current?.focus(), 250);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // polling 4s
  useEffect(() => {
    if (!session?.user?.id || !loaded) return;
    const id = setInterval(() => loadMessages(false), 4000);
    return () => clearInterval(id);
  }, [session?.user?.id, loaded, loadMessages]);

  // ── realtime mensagens ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    chatCh.current = supabasePortal
      .channel(`wchat:${roomId}`)
      .on('postgres_changes' as any, { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${roomId}` }, (payload: any) => {
        const m = payload.new;
        if (!m?.id || !m.content?.trim()) return; // ← ignora bolhas vazias
        if (m.is_system) {
          const c = (m.content||'').toLowerCase();
          if (c.includes('encerrada')) setClosed(true);
          if (c.includes('reaberta'))  setClosed(false);
          if (c.includes('entrou'))    void loadMessages(false);
        }
        if (!m.portal_client_id && !m.is_system) { setAttTyping(false); if (attTypTimer.current) clearTimeout(attTypTimer.current); }
        const msg: PortalChatMessage = { id:m.id, content:m.content, created_at:m.created_at, from_client:!!m.portal_client_id, is_system:!!m.is_system, sender_name:m.portal_client_id?null:(m.sender_name??'Escritório') };
        setMsgs(prev => {
          if (prev.some(x => x.id === msg.id)) return prev;
          // If this is a client message arriving while we have in-flight optimistics,
          // replace the matching optimistic entry by content instead of adding a duplicate.
          if (msg.from_client && inflightTids.current.size > 0) {
            const idx = [...prev].reverse().findIndex(x => inflightTids.current.has(x.id) && x.content === msg.content);
            if (idx >= 0) {
              const realIdx = prev.length - 1 - idx;
              const tempId = prev[realIdx].id;
              inflightTids.current.delete(tempId);
              return prev.map((x, i) => i === realIdx ? { ...x, id: msg.id, created_at: msg.created_at } : x);
            }
          }
          return [...prev, msg];
        });
        if (!openRef.current && !msg.from_client && !msg.is_system) setUnread(n=>n+1);
        if (openRef.current) scrollBottom();
      }).subscribe();
    return () => { if (chatCh.current) { supabasePortal.removeChannel(chatCh.current); chatCh.current = null; } };
  }, [roomId, scrollBottom, loadMessages]);

  // ── typing ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    typingCh.current = supabasePortal.channel(`wtyping:${roomId}`).subscribe();
    return () => { if (typingCh.current) { supabasePortal.removeChannel(typingCh.current); typingCh.current = null; } };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    attTypCh.current = supabasePortal.channel(`watttyping:${roomId}`)
      .on('broadcast', { event:'typing' }, (p: any) => {
        const typing = !!(p?.payload?.typing);
        setAttTyping(typing);
        if (attTypTimer.current) clearTimeout(attTypTimer.current);
        if (typing) attTypTimer.current = setTimeout(() => setAttTyping(false), 4000);
      }).subscribe();
    return () => {
      if (attTypCh.current) { supabasePortal.removeChannel(attTypCh.current); attTypCh.current = null; }
      setAttTyping(false);
    };
  }, [roomId]);

  useLayoutEffect(() => {
    if (!open) return;
    if (!loaded) return;
    scrollBottom('auto');
  }, [open, loaded, msgs.length, attTyping, closed, scrollBottom]);

  // ── envio ──────────────────────────────────────────────────────────────────
  const doSend = async (content: string) => {
    if (!content.trim() || sending || !session?.user?.id) return;

    setSending(true);
    setText('');
    typingCh.current?.send({ type: 'broadcast', event: 'typing', payload: { text: '' } });

    const tempId = crypto.randomUUID();
    inflightTids.current.add(tempId);
    setMsgs((prev) => [
      ...prev,
      {
        id: tempId,
        content,
        created_at: new Date().toISOString(),
        from_client: true,
        sender_name: null,
      },
    ]);
    scrollBottom();

    try {
      const response = await clientPortalService.sendChatMessage(session.user.id, content) as any;
      if (response) {
        inflightTids.current.delete(tempId);
        setMsgs((prev) => prev.map((message) => (
          message.id === tempId ? { ...message, id: response.id ?? tempId } : message
        )));
        if (response.room_id && response.room_id !== roomIdRef.current) {
          await loadMessages(false);
        }
      }
    } catch (error) {
      inflightTids.current.delete(tempId);
      setMsgs((prev) => prev.filter((message) => message.id !== tempId));
      throw error;
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  };

  const onTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (typTimer.current) clearTimeout(typTimer.current);
    typTimer.current = setTimeout(() => typingCh.current?.send({ type:'broadcast', event:'typing', payload:{ text:e.target.value } }), 150);
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); void doSend(text.trim()); }
  };

  const handleStartNew = async () => {
    if (!session?.user?.id || starting) return;
    setStarting(true);
    setMsgs([]); setAttendant(null); roomIdRef.current = null;
    try {
      await clientPortalService.sendChatMessage(session.user.id, 'Olá, preciso de ajuda.');
      await loadMessages(true);
      setClosed(false);
    } finally { setStarting(false); }
  };

  // ── render ─────────────────────────────────────────────────────────────────
  const groups = groupByDay(msgs.filter(m => m.content?.trim()));
  const hasContent = msgs.filter(m => !m.is_system && m.content?.trim()).length > 0;
  const isOnline = attendant?.presence_status === 'online';
  const clientName = (session?.client?.nome ?? '').split(' ')[0] || 'você';

  if (route === 'mensagens' || !session) return null;

  return createPortal(
    <>
      {/* ── Popup ─────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed right-4 z-[60] flex flex-col overflow-hidden"
          style={{ bottom: popBottom, width: popWidth, height: popHeight, borderRadius: 20, background:'#fff', boxShadow:'0 20px 60px rgba(15,23,42,0.18),0 4px 16px rgba(15,23,42,0.08)', border:'1px solid rgba(226,232,240,0.9)' }}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center gap-2.5 px-4 py-3" style={{ background:'linear-gradient(135deg,#f97316,#fb923c)', borderRadius:'20px 20px 0 0' }}>
            <div className="relative shrink-0">
              {attendant?.avatar_url
                ? <img src={attendant.avatar_url} alt={attendant.name} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30" />
                : attendant
                ? <div className="h-9 w-9 rounded-full bg-white/20 ring-2 ring-white/30 flex items-center justify-center text-[12px] font-bold text-white">{initials(attendant.name)}</div>
                : <div className="h-9 w-9 rounded-full bg-white/20 ring-2 ring-white/30 flex items-center justify-center"><MessageCircle className="h-4 w-4 text-white" /></div>
              }
              {attendant && <span className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-orange-500 ${isOnline?'bg-emerald-400':'bg-slate-300'}`} />}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-white leading-tight">
                {attendant?.name ?? 'Escritório Jurídico'}
              </p>
              <p className="text-[10.5px] text-orange-100">
                {attendant ? (isOnline ? '● Online agora' : attendant.role ?? 'Advogado') : 'Atendimento jurídico'}
              </p>
            </div>

            {/* Fechar popup */}
            <button onClick={() => setOpen(false)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto" style={{ background:'#f8f9fb' }}>
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
              </div>
            ) : !hasContent ? (
              /* Welcome */
              <div className="px-4 pt-5 pb-4">
                <p className="text-[15px] font-bold text-slate-900">Olá, {clientName}! 👋</p>
                <p className="mt-1 text-[12px] text-slate-500">Como posso te ajudar hoje?</p>
                <div className="mt-4 flex flex-col gap-2">
                  {loadingSC ? (
                    <div className="flex justify-center py-3"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>
                  ) : shortcuts.map((sc, i) => (
                    <button key={i} onClick={() => void doSend(sc.message)} disabled={sending}
                      className="flex items-center gap-3 rounded-2xl bg-white px-3.5 py-2.5 text-left ring-1 ring-slate-200 transition hover:ring-orange-300 hover:shadow-sm active:scale-[0.98] disabled:opacity-50">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${sc.bg} ${sc.fg}`}>{sc.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] font-semibold text-slate-800 truncate">{sc.label}</p>
                        {sc.sub && <p className="text-[11px] text-slate-400 truncate mt-0.5">{sc.sub}</p>}
                      </div>
                      <span className="shrink-0 text-slate-300 text-lg leading-none">›</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Mensagens */
              <div className="px-3 py-3">
                {groups.map(g => (
                  <div key={g.label}>
                    <div className="flex items-center gap-2 my-3">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-400 ring-1 ring-slate-200">{g.label}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>
                    {g.msgs.map(msg =>
                      msg.is_system
                        ? <div key={msg.id} className="flex justify-center my-2"><span className="rounded-full bg-slate-200/70 px-3 py-1 text-[10.5px] text-slate-500">{msg.content}</span></div>
                        : <Bubble key={msg.id} msg={msg} />
                    )}
                  </div>
                ))}
                {attTyping && (
                  <div className="flex justify-start mb-1">
                    <div className="rounded-[14px] rounded-bl-[4px] bg-white ring-1 ring-slate-100 shadow-sm"><Dots /></div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Footer */}
          {closed ? (
            <div className="shrink-0 border-t border-slate-100 bg-white px-3 py-3">
              <p className="mb-2 text-center text-[11px] text-slate-400">Conversa encerrada pelo escritório</p>
              <button onClick={() => void handleStartNew()} disabled={starting}
                className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-orange-500 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(249,115,22,0.28)] disabled:opacity-50">
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Iniciar nova conversa
              </button>
            </div>
          ) : (
            <div className="shrink-0 border-t border-slate-100 bg-white px-3 py-2.5">
              <div className="flex items-end gap-2">
                <textarea ref={inputRef} value={text} onChange={onTextChange} onKeyDown={onKey}
                  placeholder="Escreva uma mensagem..." rows={1}
                  className="flex-1 resize-none rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-100"
                  style={{ minHeight:38, maxHeight:96 }}
                  onInput={e => { const el=e.currentTarget; el.style.height='auto'; el.style.height=`${Math.min(el.scrollHeight,96)}px`; }}
                />
                <button onClick={() => void doSend(text.trim())} disabled={!text.trim()||sending}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] bg-orange-500 text-white shadow-[0_4px_12px_rgba(249,115,22,0.28)] transition disabled:opacity-40">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Launcher ──────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(v => !v)}
        className="fixed right-4 z-[60] flex h-[52px] w-[52px] items-center justify-center rounded-full bg-orange-500 text-white shadow-[0_8px_28px_rgba(249,115,22,0.40)] transition-all active:scale-95"
        style={{ bottom: btnBottom }}
        aria-label="Chat com o escritório"
      >
        {open
          ? <ChevronDown className="h-5 w-5" />
          : <>
              <MessageCircle className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </>
        }
      </button>

      <style>{`@keyframes wDot{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}`}</style>
    </>,
    document.body,
  );
};

export default PortalChatWidget;
