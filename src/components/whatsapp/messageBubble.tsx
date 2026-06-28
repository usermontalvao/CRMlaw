// Bolha de mensagem + conteúdo de mídia da thread do WhatsApp.
// Apresentacional (props-driven), extraído do god-module `WhatsAppModule.tsx`.
// `MessageBubble` e `ImageAlbum` são consumidos pelo orquestrador; os demais
// (`WaAudioPlayer`, `MediaContent`, `MediaPlaceholder`) são internos.
import React, { useRef, useState } from 'react';
import {
  Pencil, RotateCcw, Calendar, ListTodo, CornerUpLeft, Loader2, AlertCircle,
  CheckCheck, Check, X, Pause, Play, FileText, Download,
} from 'lucide-react';
import { formatTime, typeLabel, maskSensitive, fmtAudioTime, formatBytes } from './format';
import type { WhatsAppMessage } from '../../types/whatsapp.types';

export const MessageBubble: React.FC<{
  m: WhatsAppMessage;
  repliedTo: WhatsAppMessage | null;
  senderName: string | null;
  senderRole?: string | null;
  privateMode?: boolean;
  canCreateFollowups?: boolean;
  onReply: (m: WhatsAppMessage) => void;
  onEdit: (m: WhatsAppMessage) => void;
  onOpenImage: (url: string) => void;
  onRetry: (m: WhatsAppMessage) => void;
  onDiscard: (m: WhatsAppMessage) => void;
  onResend: (m: WhatsAppMessage) => void;
  uploadProgress?: number;
  onCancel: (m: WhatsAppMessage) => void;
  onCreateDeadline: (m: WhatsAppMessage) => void;
  onCreateTask: (m: WhatsAppMessage) => void;
}> = React.memo(({ m, repliedTo, senderName, senderRole, privateMode, canCreateFollowups, onReply, onEdit, onOpenImage, onRetry, onDiscard, onResend, uploadProgress, onCancel, onCreateDeadline, onCreateTask }) => {
  const out = m.direction === 'out';
  const failed = m._local === 'failed' || m.status === 'failed';
  const busy = m._local === 'uploading' || m._local === 'sending';
  // Reenvio rápido: só faz sentido para mídia já entregue (com objeto no storage).
  const canResend = out && !busy && !failed && m.type !== 'text' && !!m.storage_path;
  // Imagem/vídeo sem legenda/reply/nome → bolha sem moldura (igual WhatsApp):
  // a mídia "sangra" até a borda e a hora fica sobreposta num canto.
  const mediaOnly = (m.type === 'image' || m.type === 'video') && !!m.media_url && !m.content && !repliedTo && !senderName;

  return (
    <div className={`group flex items-end gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
      {/* Ações (hover) */}
      {out && (
        <div className="wa-msg-actions flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition self-center">
          {m.type === 'text' && m.evolution_message_id && (
            <button title="Editar" onClick={() => onEdit(m)} className="text-slate-400 hover:text-amber-600"><Pencil size={13} /></button>
          )}
          {canResend && (
            <button title="Reenviar arquivo" onClick={() => onResend(m)} className="text-slate-400 hover:text-amber-600"><RotateCcw size={13} /></button>
          )}
          {canCreateFollowups && !m._tempId && <button title="Criar prazo" onClick={() => onCreateDeadline(m)} className="text-slate-400 hover:text-amber-600"><Calendar size={13} /></button>}
          {canCreateFollowups && !m._tempId && <button title="Criar tarefa" onClick={() => onCreateTask(m)} className="text-slate-400 hover:text-amber-600"><ListTodo size={13} /></button>}
          <button title="Responder" onClick={() => onReply(m)} className="text-slate-400 hover:text-amber-600"><CornerUpLeft size={13} /></button>
        </div>
      )}

      <div className={`wa-bubble wa-bubble-in ${out ? 'origin-bottom-right' : 'origin-bottom-left'} relative text-[13.5px] leading-snug text-slate-800 rounded-2xl ${m.type === 'audio' ? '' : 'shadow-sm'} ${out ? 'rounded-br-sm' : 'rounded-bl-sm'} ${mediaOnly ? 'max-w-[280px] p-0 overflow-hidden bg-black/5' : `max-w-[70%] px-3 py-2 border ${out ? 'bg-[#E8F5E9] border-[#C8E6C9]' : 'bg-white border-slate-200/70'}`}`}>
        {senderName && (
          <span className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-tight text-emerald-700 truncate">{senderName}</span>
            {senderRole && (
              <span className="shrink-0 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wide bg-emerald-200 text-emerald-800">{senderRole}</span>
            )}
          </span>
        )}

        {repliedTo && (
          <div className={`mb-1 px-2 py-1 rounded-md border-l-2 text-[12px] border-emerald-500 ${out ? 'bg-black/[0.04]' : 'bg-slate-100'}`}>
            <span className="block font-semibold text-emerald-700">{repliedTo.direction === 'out' ? 'Você' : 'Contato'}</span>
            <span className="block truncate text-slate-500">{repliedTo.content || typeLabel(repliedTo.type)}</span>
          </div>
        )}

        <MediaContent m={m} out={out} onOpenImage={onOpenImage} />

        {m.content && m.type !== 'text' && (
          <span className="block mt-1 whitespace-pre-wrap break-words">
            {privateMode ? maskSensitive(m.content) : m.content}
          </span>
        )}
        {m.content && m.type === 'text' && (
          <span className="whitespace-pre-wrap break-words">
            {(() => {
              const raw = out ? m.content.replace(/^\*[^*]+:\*\n/, '') : m.content;
              return privateMode ? maskSensitive(raw) : raw;
            })()}
          </span>
        )}

        <span className={mediaOnly
          ? 'absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]'
          : 'flex items-center gap-1 justify-end mt-1 text-[10px] text-slate-500'}>
          {m.edited_at && <span className="italic opacity-80">editado</span>}
          {busy && <Loader2 size={11} className="animate-spin" />}
          {formatTime(m.wa_timestamp)}
          {out && !busy && (failed
            ? <AlertCircle size={12} className="text-red-500" />
            : m.status === 'read'
              ? <CheckCheck size={12} className={mediaOnly ? 'text-sky-300' : 'text-sky-500'} />
            : m.status === 'delivered'
              ? <CheckCheck size={12} className="opacity-50" />
            : <Check size={12} className="opacity-50" />)}
        </span>

        {/* Barra de progresso de upload + botão cancelar (Fase D) */}
        {m._local === 'uploading' && uploadProgress !== undefined && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="flex-1 h-1 rounded-full bg-emerald-600/20 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-[width] duration-300"
                style={{ width: `${uploadProgress}%` }} />
            </div>
            <span className="text-[10px] text-slate-500 tabular-nums">{uploadProgress}%</span>
            {m._tempId && (
              <button onClick={() => onCancel(m)} title="Cancelar envio"
                className="text-slate-500 hover:text-slate-700 transition leading-none">
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {/* Falha no envio: tentar de novo ou descartar da fila */}
        {failed && m._tempId && (
          <span className="flex items-center gap-2 justify-end mt-1 text-[11px] font-semibold">
            <span className="text-red-600">Não enviado</span>
            <button onClick={() => onRetry(m)} className="underline hover:no-underline text-emerald-700">Tentar de novo</button>
            <button onClick={() => onDiscard(m)} className="text-slate-500 hover:text-slate-700">Descartar</button>
          </span>
        )}
      </div>

      {!out && (
        <div className="wa-msg-actions flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition self-center">
          <button title="Responder" onClick={() => onReply(m)} className="text-slate-400 hover:text-amber-600"><CornerUpLeft size={13} /></button>
          {canCreateFollowups && !m._tempId && <button title="Criar prazo" onClick={() => onCreateDeadline(m)} className="text-slate-400 hover:text-amber-600"><Calendar size={13} /></button>}
          {canCreateFollowups && !m._tempId && <button title="Criar tarefa" onClick={() => onCreateTask(m)} className="text-slate-400 hover:text-amber-600"><ListTodo size={13} /></button>}
        </div>
      )}
    </div>
  );
});
MessageBubble.displayName = 'MessageBubble';

// ── Player de áudio estilo WhatsApp (play/pause + onda clicável + tempo/velocidade) ──
const WA_AUDIO_BARS = Array.from({ length: 30 }, (_, i) => 25 + ((i * 41 + i * i * 7) % 75));
const WaAudioPlayer: React.FC<{ src: string }> = ({ src }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);

  const toggle = () => { const a = audioRef.current; if (!a) return; if (a.paused) void a.play(); else a.pause(); };
  const cycleRate = () => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(next); if (audioRef.current) audioRef.current.playbackRate = next; };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current; if (!a || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * duration; setCurrent(a.currentTime);
  };
  const progress = duration > 0 ? (current / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2.5 select-none" style={{ minWidth: '200px', maxWidth: '250px' }}>
      <audio ref={audioRef} src={src} preload="metadata"
        onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={e => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrent(0); }} className="hidden" />
      <button type="button" onClick={toggle} title={playing ? 'Pausar' : 'Reproduzir'}
        className="shrink-0 w-9 h-9 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-sm active:scale-95 transition">
        {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-end gap-[2px] h-6 cursor-pointer" onClick={seek} title="Avançar / retroceder">
          {WA_AUDIO_BARS.map((h, i) => {
            const filled = (i / WA_AUDIO_BARS.length) * 100 <= progress;
            return <div key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: filled ? '#059669' : 'rgba(0,0,0,0.18)' }} />;
          })}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[10px] text-slate-500 tabular-nums font-semibold">{playing || current > 0 ? fmtAudioTime(current) : fmtAudioTime(duration)}</span>
          <button type="button" onClick={cycleRate} title="Velocidade"
            className="text-[9px] font-bold text-slate-500 bg-black/[0.06] hover:bg-black/[0.12] rounded px-1 py-0.5 transition leading-none">{rate}x</button>
        </div>
      </div>
    </div>
  );
};

// ── Conteúdo de mídia por tipo ──
const MediaContent: React.FC<{ m: WhatsAppMessage; out: boolean; onOpenImage: (url: string) => void }> = ({ m, out, onOpenImage }) => {
  if (m.type === 'text') return null;
  const url = m.media_url;

  if (m.type === 'image') {
    return url
      ? <img src={url} alt={m.content || 'imagem'} onClick={() => onOpenImage(url)}
          className="rounded-lg max-w-[260px] max-h-[300px] object-cover cursor-pointer" />
      : <MediaPlaceholder label={typeLabel('image')} />;
  }

  if (m.type === 'video') {
    return url
      ? <video src={url} controls className="rounded-lg max-w-[260px] max-h-[300px]" />
      : <MediaPlaceholder label={typeLabel('video')} />;
  }

  if (m.type === 'audio') {
    return (
      <div className="min-w-[220px]">
        {url ? <WaAudioPlayer src={url} />
          : <MediaPlaceholder label={typeLabel('audio')} />}
        {m.transcription_status === 'pending' && (
          <span className="flex items-center gap-1 mt-1 text-[11px] italic text-slate-400"><Loader2 size={11} className="animate-spin" /> Transcrevendo…</span>
        )}
        {m.transcription_status === 'done' && m.transcription_text && (
          <p className="mt-1 text-[12px] italic text-slate-500">“{m.transcription_text}”</p>
        )}
        {m.transcription_status === 'failed' && (
          <span className="block mt-1 text-[11px] italic text-slate-400">Transcrição indisponível</span>
        )}
      </div>
    );
  }

  // documento
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" download={m.file_name || undefined}
      className={`flex items-center gap-2.5 min-w-[200px] px-2 py-1.5 rounded-lg ${out ? 'bg-black/[0.05] hover:bg-black/[0.08]' : 'bg-slate-100 hover:bg-slate-200'} transition`}>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white text-emerald-600 shadow-sm"><FileText size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold truncate text-slate-800">{m.file_name || 'Documento'}</span>
        <span className="block text-[11px] text-slate-400">{formatBytes(m.media_size)}</span>
      </span>
      {url && <Download size={16} className="text-slate-400" />}
    </a>
  );
};

const MediaPlaceholder: React.FC<{ label: string }> = ({ label }) => (
  <span className="flex items-center gap-1.5 text-[12px] opacity-80"><Loader2 size={12} className="animate-spin" /> {label}</span>
);

// ── Álbum de imagens (estilo WhatsApp) — agrupa imagens enviadas juntas ──
// Mostra até 4 miniaturas num grid; "+N" no excedente. Legenda da 1ª imagem e
// hora/status da última, como no WhatsApp. Cada célula abre o lightbox.
export const ImageAlbum: React.FC<{ items: WhatsAppMessage[]; out: boolean; senderName: string | null; onOpenImage: (url: string) => void }> = React.memo(({ items, out, senderName, onOpenImage }) => {
  const shown = items.slice(0, 4);
  const extra = items.length - shown.length;
  const last = items[items.length - 1];
  const caption = items.find(i => i.content)?.content || '';
  const busy = items.some(i => i._local === 'uploading' || i._local === 'sending');
  // Mídia sangra até a borda (igual WhatsApp): sem moldura verde. Nome do remetente
  // e legenda ficam sobrepostos; a hora vai num canto sobre a imagem.
  const ticks = !busy && out && (last.status === 'read'
    ? <CheckCheck size={12} className="text-sky-300" />
    : last.status === 'delivered' ? <CheckCheck size={12} className="opacity-50" /> : <Check size={12} className="opacity-50" />);
  return (
    <div className={`wa-msg-in group flex items-end gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
      <div className="max-w-[280px]">
        <div className={`relative grid gap-1 w-64 ${shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} rounded-2xl overflow-hidden shadow-sm`}>
          {shown.map((m, i) => {
            const overlay = i === shown.length - 1 && extra > 0;
            return (
              <button key={m._tempId || m.id} onClick={() => m.media_url && onOpenImage(m.media_url)}
                className="relative aspect-square overflow-hidden bg-black/10">
                {m.media_url
                  ? <img src={m.media_url} alt={m.content || 'imagem'} className="w-full h-full object-cover hover:opacity-95 transition" />
                  : <span className="w-full h-full flex items-center justify-center"><Loader2 size={16} className="animate-spin text-white/70" /></span>}
                {overlay && <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-[18px] font-bold">+{extra}</span>}
              </button>
            );
          })}
          {senderName && (
            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px] font-bold">{senderName}</span>
          )}
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/45 text-white text-[10px]">
            {busy && <Loader2 size={11} className="animate-spin" />}
            {formatTime(last.wa_timestamp)}
            {ticks}
          </span>
        </div>
        {caption && <p className="pt-1 text-[13px] leading-snug whitespace-pre-wrap break-words text-slate-800">{caption}</p>}
      </div>
    </div>
  );
});
ImageAlbum.displayName = 'ImageAlbum';
