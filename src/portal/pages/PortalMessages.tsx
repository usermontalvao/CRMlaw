import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import {
  Send, Loader2, MessageCircle, Lock, Plus,
  Mic, MicOff, Paperclip, Image as ImageIcon,
  FileText, Download, Play, Pause, X, Check, CheckCheck,
} from 'lucide-react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { usePortalNotifications } from '../contexts/PortalNotificationsContext';
import { clientPortalService } from '../services/clientPortal.service';
import { supabasePortal } from '../lib/supabasePortal';
import type { PortalChatMessage } from '../../types/chat.types';

// ─── Constantes ───────────────────────────────────────────────────────────────
const PORTAL_BUCKET   = 'portal-chat';
const ATTACH_PREFIX   = '__anexo__:';
const MAX_FILE_MB     = 20;
const MAX_AUDIO_S     = 120; // 2 min

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface AttachPayload {
  filePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  bucket: string;
  url?: string;       // pre-signed URL included by scanner upload (avoids client-side signing)
  displayPath?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDay(iso: string) {
  const d = new Date(iso);
  const today     = new Date();
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString())     return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

function formatSeconds(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function parseAttach(content: string): AttachPayload | null {
  if (!content.startsWith(ATTACH_PREFIX)) return null;
  try { return JSON.parse(content.slice(ATTACH_PREFIX.length)); }
  catch { return null; }
}

// ─── Componentes auxiliares ────────────────────────────────────────────────
const TypingDots: React.FC = () => (
  <span className="flex gap-[3px] items-center">
    {[0, 1, 2].map(i => (
      <span key={i} className="block w-1.5 h-1.5 rounded-full bg-slate-400"
        style={{ animation: `portalDot 1.2s ease-in-out ${i * 0.18}s infinite` }} />
    ))}
    <style>{`@keyframes portalDot{0%,60%,100%{opacity:.25;transform:scale(.8)}30%{opacity:1;transform:scale(1)}}`}</style>
  </span>
);

// Player de áudio leve
const AudioPlayer: React.FC<{ src: string }> = ({ src }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dur, setDur] = useState(0);
  const ref = useRef<HTMLAudioElement>(null);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else         { void a.play(); setPlaying(true); }
  };

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <audio ref={ref} src={src} preload="metadata"
        onLoadedMetadata={e => setDur(Math.floor((e.target as HTMLAudioElement).duration))}
        onTimeUpdate={e  => { const a = e.target as HTMLAudioElement; setProgress(a.duration ? a.currentTime / a.duration : 0); }}
        onEnded={() => { setPlaying(false); setProgress(0); if (ref.current) ref.current.currentTime = 0; }}
      />
      <button onClick={toggle}
        className="h-8 w-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0 transition">
        {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1 flex flex-col gap-0.5">
        <div className="h-1.5 rounded-full bg-[#f8f7f5]/20 overflow-hidden">
          <div className="h-full rounded-full bg-[#f8f7f5]/70 transition-all" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="text-[10px] opacity-60">{formatSeconds(dur)}</span>
      </div>
    </div>
  );
};

// ─── Componente principal ─────────────────────────────────────────────────────
export const PortalMessages: React.FC = () => {
  const { session } = useClientAuth();
  const { markChatRepliesRead } = usePortalNotifications();

  interface AttendantInfo {
    name: string;
    role?: string | null;
    avatar_url?: string | null;
    presence_status?: string | null;
    lawyer_full_name?: string | null;
  }

  const [messages, setMessages]           = useState<PortalChatMessage[]>([]);
  const [roomId, setRoomId]               = useState<string | null>(null);
  const [isClosed, setIsClosed]           = useState(false);
  const [loading, setLoading]             = useState(true);
  const [text, setText]                   = useState('');
  const [sending, setSending]             = useState(false);
  const [startingNew, setStartingNew]     = useState(false);
  const [attendantTyping, setAttendantTyping] = useState(false);
  const [attendant, setAttendant]         = useState<AttendantInfo | null>(null);

  // Áudio
  const [recording, setRecording]         = useState(false);
  const [recSec, setRecSec]               = useState(0);
  const [uploading, setUploading]         = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const recTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null);

  // Signed URLs cache (path → url)
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());

  const bottomRef              = useRef<HTMLDivElement>(null);
  const messagesContainerRef   = useRef<HTMLDivElement | null>(null);
  const inputRef               = useRef<HTMLTextAreaElement>(null);
  const fileInputRef           = useRef<HTMLInputElement>(null);
  const imageInputRef          = useRef<HTMLInputElement>(null);
  const chatChannel            = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typingChannel          = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const attendantTypingChannel = useRef<ReturnType<typeof supabasePortal.channel> | null>(null);
  const typingTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attendantTypingTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roomIdRef              = useRef<string | null>(null);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const run = () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
      }
      bottomRef.current?.scrollIntoView({ behavior, block: 'end' });
    };
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }, []);

  // Auto-scroll quando chegam novas mensagens
  const prevMsgCountRef = useRef(0);
  useEffect(() => {
    if (messages.length === 0) { prevMsgCountRef.current = 0; return; }
    if (messages.length > prevMsgCountRef.current) {
      prevMsgCountRef.current = messages.length;
      // Sempre rola — o isNearBottom nunca deveria bloquear quando chega uma msg nova
      scrollToBottom('smooth');
    }
  }, [messages.length, scrollToBottom]);

  useLayoutEffect(() => {
    if (!loading) scrollToBottom('auto');
  }, [loading, messages.length, attendantTyping, isClosed, scrollToBottom]);

  // ── Signed URL ──────────────────────────────────────────────────────────────
  const getSignedUrl = useCallback(async (bucket: string, path: string): Promise<string | null> => {
    const key = `${bucket}:${path}`;
    if (signedUrls.has(key)) return signedUrls.get(key)!;
    if (bucket === 'client-documents') return null;
    try {
      const { data, error } = await supabasePortal.storage.from(bucket).createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return null;
      setSignedUrls(prev => new Map(prev).set(key, data.signedUrl));
      return data.signedUrl;
    } catch { return null; }
  }, [signedUrls]);

  // ── Carregar mensagens ───────────────────────────────────────────────────────
  const loadMessages = useCallback(async (showLoader = false) => {
    if (!session?.user?.id) return;
    if (showLoader) setLoading(true);
    // Captura o roomId ANTES do await para evitar race condition com o ref mutável
    const capturedRoomId = roomIdRef.current;
    try {
      const data = await clientPortalService.getChatMessages(session.user.id);
      if (!data) return;
      const newRoomId = data.room.id;
      const newClosed = !!(data.room as any).is_closed;
      const roomChanged = !capturedRoomId || capturedRoomId !== newRoomId;

      setMessages(prev => {
        if (roomChanged) return data.messages; // Sala nova: nunca mescla histórico antigo
        // Mesma sala: adiciona apenas msgs otimistas locais ainda não confirmadas
        const serverIds = new Set(data.messages.map((m: any) => m.id));
        const localOnly = prev.filter(m => !serverIds.has(m.id));
        if (!localOnly.length) return data.messages;
        return [...data.messages, ...localOnly].sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });

      if (roomIdRef.current !== newRoomId) {
        roomIdRef.current = newRoomId;
        setRoomId(newRoomId);
      }
      setIsClosed(newClosed);
      // Sempre atualiza attendant (null limpa o atendente anterior quando nova conversa sem aceite)
      setAttendant((data as any).attendant ?? null);

      // Ao trocar de sala, sempre rola para o fim
      if (roomChanged) setTimeout(() => scrollToBottom('auto'), 100);
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [session?.user?.id, scrollToBottom]);

  useEffect(() => { loadMessages(true).then(() => scrollToBottom('auto')); }, [loadMessages, scrollToBottom]);
  useEffect(() => {
    if (!session?.user?.id) return;
    const id = setInterval(() => loadMessages(false), 4000);
    return () => clearInterval(id);
  }, [session?.user?.id, loadMessages]);

  // Zera unread de chat ao abrir a tela de mensagens (fonte única de verdade = contexto)
  useEffect(() => {
    void markChatRepliesRead();
  }, [markChatRepliesRead]);

  // ── Realtime — novas mensagens ───────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    chatChannel.current = supabasePortal
      .channel(`portal-chat:${roomId}`)
      .on('postgres_changes' as any, { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, (payload: any) => {
        const m = payload.new;
        if (m.is_system) {
          const c = (m.content || '').toLowerCase();
          if (c.includes('encerrada'))            setIsClosed(true);
          if (c.includes('reaberta'))             setIsClosed(false);
          if (c.includes('entrou na conversa') || c.includes('atendimento iniciado')) void loadMessages(false);
        }
        if (!m.portal_client_id && !m.is_system) { setAttendantTyping(false); if (attendantTypingTimer.current) clearTimeout(attendantTypingTimer.current); }
        const msg: PortalChatMessage = { id: m.id, content: m.content, created_at: m.created_at, from_client: !!m.portal_client_id, is_system: !!m.is_system, sender_name: m.portal_client_id ? null : 'Escritório' };
        setMessages(prev => prev.some(x => x.id === msg.id) ? prev : [...prev, msg]);
        scrollToBottom();
      })
      .subscribe();
    return () => { if (chatChannel.current) { supabasePortal.removeChannel(chatChannel.current); chatChannel.current = null; } };
  }, [roomId, scrollToBottom, loadMessages]);

  // ── Typing channels ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId) return;
    typingChannel.current = supabasePortal.channel(`portal-typing:${roomId}`).subscribe();
    return () => { if (typingChannel.current) { supabasePortal.removeChannel(typingChannel.current); typingChannel.current = null; } };
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    attendantTypingChannel.current = supabasePortal
      .channel(`portal-attendant-typing:${roomId}`)
      .on('broadcast', { event: 'typing' }, (payload: any) => {
        const typing = !!(payload?.payload?.typing);
        setAttendantTyping(typing);
        if (attendantTypingTimer.current) clearTimeout(attendantTypingTimer.current);
        if (typing) attendantTypingTimer.current = setTimeout(() => setAttendantTyping(false), 4000);
      }).subscribe();
    return () => { if (attendantTypingChannel.current) { supabasePortal.removeChannel(attendantTypingChannel.current); attendantTypingChannel.current = null; } setAttendantTyping(false); };
  }, [roomId]);

  // ── Upload de arquivo ────────────────────────────────────────────────────────
  const uploadAndSend = useCallback(async (file: File, extraPath = '') => {
    if (!session?.user?.id) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) { alert(`Arquivo muito grande. Máximo ${MAX_FILE_MB} MB.`); return; }
    setUploading(true);
    try {
      const ext      = file.name.split('.').pop() || 'bin';
      const safeName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const path     = `${session.user.id}/${extraPath}${safeName}`;
      const { error: upErr } = await supabasePortal.storage.from(PORTAL_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { console.error('Upload error', upErr); return; }

      const payload: AttachPayload = { filePath: path, fileName: file.name, mimeType: file.type, size: file.size, bucket: PORTAL_BUCKET };
      const content = `${ATTACH_PREFIX}${JSON.stringify(payload)}`;
      const result = await clientPortalService.sendChatMessage(session.user.id, content);
      if (result) {
        const r = result as any;
        const msg: PortalChatMessage = { id: r.id ?? crypto.randomUUID(), content, created_at: new Date().toISOString(), from_client: true, sender_name: null };
        setMessages(prev => prev.some(x => x.id === msg.id) ? prev : [...prev, msg]);
        if (r.room_id && r.room_id !== roomIdRef.current) await loadMessages(false);
        scrollToBottom();
      }
    } finally { setUploading(false); }
  }, [session?.user?.id, loadMessages, scrollToBottom]);

  // ── Gravação de áudio ────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr     = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], 'audio.webm', { type: 'audio/webm' });
        await uploadAndSend(file, 'audio/');
      };
      mr.start(250);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setRecSec(0);
      recTimerRef.current = setInterval(() => setRecSec(s => {
        if (s + 1 >= MAX_AUDIO_S) { stopRecording(); return s; }
        return s + 1;
      }), 1000);
    } catch { alert('Sem permissão para usar o microfone.'); }
  }, [uploadAndSend]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecSec(0);
  }, []);

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    setRecording(false);
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    setRecSec(0);
  }, []);

  // ── Envio de texto ───────────────────────────────────────────────────────────
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { text: e.target.value } });
    }, 150);
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending || !session?.user?.id) return;
    setSending(true);
    setText('');
    typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { text: '' } });
    const result = await clientPortalService.sendChatMessage(session.user.id, content);
    setSending(false);
    if (result) {
      const r = result as any;
      const msg: PortalChatMessage = { id: r.id ?? crypto.randomUUID(), content, created_at: new Date().toISOString(), from_client: true, sender_name: null };
      setMessages(prev => prev.some(x => x.id === msg.id) ? prev : [...prev, msg]);
      if (r.room_id && r.room_id !== roomIdRef.current) await loadMessages(false);
      scrollToBottom();
    }
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  const handleStartNew = async () => {
    if (!session?.user?.id || startingNew) return;
    setStartingNew(true);
    // Reseta estado imediatamente para não mostrar histórico antigo
    setMessages([]);
    setAttendant(null);
    roomIdRef.current = null;   // Força detecção de "sala nova" no próximo loadMessages
    prevMsgCountRef.current = 0;
    try {
      await clientPortalService.sendChatMessage(session.user.id, 'Olá, preciso de ajuda.');
      await loadMessages(true);
      setIsClosed(false);
    } finally { setStartingNew(false); }
  };

  // ── Renderização de anexo ────────────────────────────────────────────────────
  const AttachBubble: React.FC<{ attach: AttachPayload; isClient: boolean }> = ({ attach, isClient }) => {
    const isScannerAttachment = attach.bucket === 'client-documents';
    const [url, setUrl] = useState<string | null>(attach.url ?? null);
    const [loadingUrl, setLoadingUrl] = useState(!attach.url && !isScannerAttachment);

    useEffect(() => {
      if (attach.url) { setUrl(attach.url); setLoadingUrl(false); return; }
      if (isScannerAttachment) { setUrl(null); setLoadingUrl(false); return; }
      getSignedUrl(attach.bucket, attach.filePath).then(u => { setUrl(u); setLoadingUrl(false); });
    }, [attach.bucket, attach.filePath, attach.url, isScannerAttachment]);

    if (loadingUrl) return <div className="flex items-center gap-2 py-1"><Loader2 className="w-4 h-4 animate-spin opacity-50" /><span className="text-xs opacity-60">Carregando…</span></div>;
    if (!url)       return <div className="text-xs opacity-50">Arquivo indisponível</div>;

    const mime = attach.mimeType;

    if (mime.startsWith('audio/')) return <AudioPlayer src={url} />;

    if (mime.startsWith('image/')) return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={url} alt={attach.fileName} className="max-w-[220px] max-h-[180px] rounded-xl object-cover" onLoad={() => scrollToBottom()} />
      </a>
    );

    if (mime.startsWith('video/')) return (
      <video controls className="max-w-[220px] max-h-[160px] rounded-xl" src={url} />
    );

    return (
      <a href={url} target="_blank" rel="noopener noreferrer" download={attach.fileName}
        className={`flex items-center gap-2.5 py-1 group ${isClient ? 'text-white' : 'text-slate-800'}`}>
        <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${isClient ? 'bg-[#f8f7f5]/20' : 'bg-orange-100'}`}>
          <FileText className={`w-4 h-4 ${isClient ? 'text-white' : 'text-orange-500'}`} />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium truncate max-w-[140px]">{attach.fileName}</span>
          <span className="text-[10px] opacity-60">{formatFileSize(attach.size)}</span>
        </div>
        <Download className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition shrink-0" />
      </a>
    );
  };

  // ── Agrupar por dia ──────────────────────────────────────────────────────────
  const grouped: { day: string; msgs: PortalChatMessage[] }[] = [];
  for (const m of messages) {
    const day = formatDay(m.created_at);
    const last = grouped[grouped.length - 1];
    if (last?.day === day) last.msgs.push(m);
    else grouped.push({ day, msgs: [m] });
  }

  // ── JSX ──────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-x-3 top-[72px] bottom-[80px] z-[5] flex flex-col lg:relative lg:inset-auto lg:top-auto lg:bottom-auto lg:z-auto lg:h-[calc(100vh-6rem)]">
      {/* Inputs de arquivo ocultos */}
      <input ref={fileInputRef}  type="file" accept="*/*"         className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAndSend(f, 'files/');  e.target.value = ''; }} />
      <input ref={imageInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void uploadAndSend(f, 'media/'); e.target.value = ''; }} />

      <header className="hidden lg:block shrink-0 pb-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 lg:text-[26px]">Mensagens</h1>
        <p className="mt-0.5 text-sm text-slate-500">Fale diretamente com o escritório.</p>
      </header>

      <div className="flex flex-col flex-1 min-h-0 rounded-2xl border border-slate-200 bg-[#f8f7f5] overflow-hidden shadow-[0_8px_32px_rgba(15,23,42,0.10)]">
        {/* Header da conversa — perfil do atendente */}
        {attendant ? (
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-[#f8f7f5]">
            {/* Avatar */}
            <div className="relative shrink-0">
              {attendant.avatar_url ? (
                <img src={attendant.avatar_url} alt={attendant.name} className="h-10 w-10 rounded-full object-cover ring-2 ring-orange-100" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-orange-400 to-amber-500 flex items-center justify-center text-white text-sm font-bold ring-2 ring-orange-100">
                  {attendant.name.split(' ').slice(0, 2).map(n => n[0]).join('').toUpperCase()}
                </div>
              )}
              {/* Status online */}
              <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${attendant.presence_status === 'online' ? 'bg-emerald-400' : 'bg-slate-300'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-slate-900 leading-tight truncate">
                {attendant.lawyer_full_name || attendant.name}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[11px] text-slate-400 capitalize">
                  {attendant.role === 'admin' ? 'Administrador' : attendant.role === 'manager' ? 'Gerente' : 'Advogado'}
                </p>
                <span className="w-1 h-1 rounded-full bg-slate-300" />
                {attendantTyping ? (
                  <span className="flex items-center gap-1 text-[11px] text-orange-500 font-medium">
                    escrevendo <span className="flex gap-0.5">{[0,1,2].map(i=><span key={i} className="w-1 h-1 rounded-full bg-orange-400" style={{animation:`portalDot 1.2s ease-in-out ${i*.18}s infinite`}}/>)}</span>
                  </span>
                ) : (
                  <span className={`text-[11px] font-medium ${attendant.presence_status === 'online' ? 'text-emerald-500' : 'text-slate-400'}`}>
                    {attendant.presence_status === 'online' ? '● Online' : '● Offline'}
                  </span>
                )}
              </div>
            </div>
            {isClosed && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full px-2.5 py-1 shrink-0">
                <Lock className="h-3 w-3" />Encerrada
              </span>
            )}
          </div>
        ) : (
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50">
            <div className="h-9 w-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <MessageCircle className="h-4 w-4 text-orange-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 leading-tight">Escritório</p>
              <p className="text-[11px] text-slate-400">
                {isClosed ? 'Conversa encerrada' : 'Aguardando atendimento'}
              </p>
            </div>
            {isClosed && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">
                <Lock className="h-3 w-3" />Encerrada
              </span>
            )}
          </div>
        )}

        {/* Lista de mensagens */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-0.5" style={{ background: '#f8f9fb' }}>
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-12">
              <div className="h-14 w-14 rounded-2xl bg-orange-50 flex items-center justify-center">
                <MessageCircle className="h-7 w-7 text-orange-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-700">Nenhuma mensagem ainda</p>
                <p className="text-xs text-slate-400 mt-0.5">Envie uma mensagem para falar com o escritório.</p>
              </div>
            </div>
          ) : (
            grouped.map(({ day, msgs }) => (
              <div key={day}>
                {/* Separador de dia */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-full px-3 py-1 shrink-0">{day}</span>
                  <div className="flex-1 h-px bg-slate-200" />
                </div>

                {msgs.map((m, i) => {
                  // Mensagem de sistema
                  if (m.is_system) {
                    return (
                      <div key={m.id} className="flex justify-center my-3">
                        <div className="flex items-center gap-1.5 rounded-full bg-[#f8f7f5] border border-slate-200 shadow-sm px-4 py-1.5 text-[11px] font-medium text-slate-500">
                          <Lock className="h-3 w-3 text-slate-400 shrink-0" />
                          {m.content}
                        </div>
                      </div>
                    );
                  }

                  const isClient  = m.from_client;
                  const attach    = parseAttach(m.content);
                  const prevMsg   = i > 0 ? msgs[i - 1] : null;
                  const prevSame  = prevMsg && !prevMsg.is_system && prevMsg.from_client === isClient;
                  const nextMsg   = i < msgs.length - 1 ? msgs[i + 1] : null;
                  const nextSame  = nextMsg && !nextMsg.is_system && nextMsg.from_client === isClient;

                  const bubbleColor = isClient
                    ? 'bg-orange-500 text-white'
                    : 'bg-[#f8f7f5] text-slate-900 border border-slate-100';
                  const roundBase = isClient ? 'rounded-2xl rounded-br-sm' : 'rounded-2xl rounded-bl-sm';
                  const roundTop  = prevSame  ? (isClient ? 'rounded-tr-lg' : 'rounded-tl-lg') : '';
                  const roundBot  = nextSame  ? (isClient ? 'rounded-br-lg' : 'rounded-bl-lg') : '';

                  return (
                    <div key={m.id} className={`flex ${isClient ? 'justify-end' : 'justify-start'} ${prevSame ? 'mt-0.5' : 'mt-3'}`}>
                      <div className={`max-w-[78%] flex flex-col ${isClient ? 'items-end' : 'items-start'}`}>
                        {!prevSame && !isClient && (
                          <span className="text-[11px] font-semibold text-orange-500 mb-1 ml-1">
                            {m.sender_name ?? 'Escritório'}
                          </span>
                        )}
                        <div className={`px-3.5 py-2.5 shadow-sm ${bubbleColor} ${roundBase} ${roundTop} ${roundBot}`}>
                          {attach ? (
                            <AttachBubble attach={attach} isClient={isClient} />
                          ) : (
                            <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words">{m.content}</p>
                          )}
                        </div>
                        <div className={`flex items-center gap-1 mt-0.5 mx-1 ${isClient ? 'flex-row-reverse' : 'flex-row'}`}>
                          <span className="text-[10px] text-slate-400 tabular-nums">{formatTime(m.created_at)}</span>
                          {isClient && <CheckCheck className="w-3 h-3 text-orange-400" />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {/* Indicador de escrevendo... do atendente */}
          {attendantTyping && !isClosed && (
            <div className="flex justify-start mt-3">
              <div className="flex flex-col items-start">
                <span className="text-[11px] font-semibold text-orange-500 mb-1 ml-1">
                  {attendant ? (attendant.lawyer_full_name || attendant.name).split(' ')[0] : 'Escritório'}
                </span>
                <div className="bg-[#f8f7f5] border border-slate-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-0.5">
                  <TypingDots />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Área de input / conversa encerrada */}
        {isClosed ? (
          <div className="shrink-0 border-t border-slate-100 p-4 bg-[#f8f7f5]">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-slate-700 mb-1">
                <Lock className="h-3.5 w-3.5 text-slate-400" />
                Esta conversa foi encerrada
              </div>
              <p className="text-[12px] text-slate-400 mb-3">
                Precisa de mais ajuda? Abra uma nova conversa e responderemos em breve.
              </p>
              <button
                onClick={handleStartNew}
                disabled={startingNew}
                className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-orange-600 active:scale-95 disabled:opacity-60"
              >
                {startingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Iniciar nova conversa
              </button>
            </div>
          </div>
        ) : (
          <div className="shrink-0 bg-[#f8f7f5] border-t border-slate-100">
            {/* Barra de escrevendo do atendente (compacta) */}
            {attendantTyping && (
              <div className="flex items-center gap-2 px-4 pt-2 pb-0">
                <span className="text-[11px] text-slate-400">Escritório está escrevendo</span>
                <TypingDots />
              </div>
            )}

            {/* Barra de gravação */}
            {recording ? (
              <div className="flex items-center gap-3 px-3 py-3">
                <button onClick={cancelRecording} className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition" title="Cancelar">
                  <X className="w-4 h-4 text-slate-600" />
                </button>
                <div className="flex-1 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-sm font-semibold text-red-500 tabular-nums">{formatSeconds(recSec)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${(recSec / MAX_AUDIO_S) * 100}%` }} />
                  </div>
                </div>
                <button onClick={stopRecording}
                  className="h-9 w-9 rounded-xl bg-orange-500 hover:bg-orange-600 flex items-center justify-center transition shadow-sm"
                  disabled={uploading} title="Enviar áudio">
                  {uploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
                </button>
              </div>
            ) : (
              <div className="flex items-end gap-2 p-3">
                {/* Botões de mídia */}
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => imageInputRef.current?.click()} disabled={uploading}
                    className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition disabled:opacity-40" title="Enviar imagem ou vídeo">
                    <ImageIcon className="w-4 h-4 text-slate-600" />
                  </button>
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                    className="h-9 w-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition disabled:opacity-40" title="Enviar arquivo">
                    <Paperclip className="w-4 h-4 text-slate-600" />
                  </button>
                </div>

                {/* Input de texto */}
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={handleTextChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Escreva uma mensagem..."
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 max-h-32 overflow-y-auto"
                  style={{ minHeight: '42px' }}
                  onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }}
                />

                {/* Enviar ou microfone */}
                {text.trim() ? (
                  <button onClick={handleSend} disabled={sending}
                    className="h-[42px] w-[42px] shrink-0 rounded-xl bg-orange-500 hover:bg-orange-600 active:scale-95 flex items-center justify-center transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
                    {sending ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : <Send className="h-4 w-4 text-white" />}
                  </button>
                ) : (
                  <button onClick={startRecording} disabled={uploading}
                    className="h-[42px] w-[42px] shrink-0 rounded-xl bg-slate-100 hover:bg-orange-500 hover:text-white flex items-center justify-center transition disabled:opacity-40 group" title="Gravar áudio">
                    {uploading
                      ? <Loader2 className="h-4 w-4 text-slate-500 animate-spin" />
                      : <Mic className="h-4 w-4 text-slate-600 group-hover:text-white" />
                    }
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PortalMessages;
