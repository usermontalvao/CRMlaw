import React from 'react';
import type { EditingPeer } from '../hooks/useNextcloudPresence';

/**
 * EditorPresenceBar
 * -----------------------------------------------------------------------------
 * Mostra, dentro do editor, quem mais está com ESTE documento aberto e quem
 * está digitando neste instante. Fica no canto do papel, discreto, e some
 * sozinho quando ninguém mais está no arquivo (presença via websocket).
 */

/** Cor estável por usuário — a mesma pessoa tem sempre a mesma cor. */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
];

function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function firstName(name: string): string {
  const clean = name.trim();
  return clean ? clean.split(/\s+/)[0] : 'Alguém';
}

interface EditorPresenceBarProps {
  peers: EditingPeer[];
  className?: string;
}

export const EditorPresenceBar: React.FC<EditorPresenceBarProps> = ({ peers, className }) => {
  if (peers.length === 0) return null;

  const typing = peers.filter((peer) => peer.typing);
  const label =
    typing.length === 1
      ? `${firstName(typing[0].userName)} está digitando…`
      : typing.length > 1
        ? `${typing.length} pessoas digitando…`
        : peers.length === 1
          ? `${firstName(peers[0].userName)} também está neste documento`
          : `${peers.length} pessoas neste documento`;

  return (
    <div
      className={[
        'pointer-events-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-2 py-1 shadow-[0_6px_20px_rgba(15,23,42,0.12)] backdrop-blur',
        className || '',
      ].join(' ')}
      title={peers
        .map((peer) => `${peer.userName}${peer.typing ? ' — digitando agora' : ' — com o documento aberto'}`)
        .join('\n')}
    >
      <div className="flex -space-x-2">
        {peers.slice(0, 4).map((peer) => (
          <span
            key={peer.userId}
            className={[
              'relative flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-white',
              colorFor(peer.userId),
            ].join(' ')}
          >
            {initials(peer.userName)}
            {peer.typing && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
            )}
          </span>
        ))}
        {peers.length > 4 && (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-600 text-[10px] font-bold text-white ring-2 ring-white">
            +{peers.length - 4}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 pr-1 text-[11px] font-semibold text-slate-600">
        {typing.length > 0 && (
          <span className="flex items-end gap-[2px] pb-[2px]" aria-hidden>
            <span className="h-1 w-1 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.3s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-emerald-500 [animation-delay:-0.15s]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-emerald-500" />
          </span>
        )}
        {label}
      </span>
    </div>
  );
};

export default EditorPresenceBar;
