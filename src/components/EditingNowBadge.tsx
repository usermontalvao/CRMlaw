import React from 'react';
import type { EditingPeer } from '../hooks/useNextcloudPresence';
import { useUserAvatars } from '../hooks/useUserAvatars';

/**
 * EditingNowBadge
 * -----------------------------------------------------------------------------
 * Aviso de "quem está com o arquivo aberto agora" no explorador do Nextcloud.
 * Diz com todas as letras o que está acontecendo (antes era só um lápis e um
 * nome solto) e diferencia quem está apenas com o documento aberto de quem
 * está digitando neste instante.
 */

function firstName(name: string): string {
  const clean = name.trim();
  if (!clean) return 'Alguém';
  return clean.split(/\s+/)[0];
}

function describe(peers: EditingPeer[], compact: boolean): string {
  const typing = peers.filter((peer) => peer.typing);
  const [first] = peers;
  const others = peers.length - 1;
  const name = compact ? firstName(first.userName) : first.userName;

  if (peers.length === 1) {
    return typing.length > 0 ? `${name} está digitando…` : `${name} está editando`;
  }
  if (typing.length > 0) {
    const typer = compact ? firstName(typing[0].userName) : typing[0].userName;
    return `${typer} está digitando · +${peers.length - 1}`;
  }
  return `${name} +${others} editando`;
}

function tooltip(peers: EditingPeer[]): string {
  const lines = peers.map(
    (peer) => `• ${peer.userName}${peer.typing ? ' — digitando agora' : ' — com o documento aberto'}`,
  );
  return `Editando agora:\n${lines.join('\n')}\n\nSe você abrir e salvar por cima, pode sobrescrever o trabalho ${peers.length > 1 ? 'deles' : 'dele/dela'}.`;
}

interface EditingNowBadgeProps {
  peers: EditingPeer[];
  /** `compact` = grade de ícones (espaço curto); padrão = lista. */
  compact?: boolean;
  className?: string;
}

/** Cor estável por pessoa, para quando não houver foto. */
const AVATAR_COLORS = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** A pessoa aparece pela FOTO; as iniciais são só o plano B. */
const PeerFace: React.FC<{ peer: EditingPeer; avatarUrl: string | null; size: string }> = ({
  peer,
  avatarUrl,
  size,
}) => {
  const [brokenImage, setBrokenImage] = React.useState(false);
  const showPhoto = Boolean(avatarUrl) && !brokenImage;

  if (showPhoto) {
    return (
      <img
        src={avatarUrl as string}
        alt={peer.userName}
        loading="lazy"
        decoding="async"
        onError={() => setBrokenImage(true)}
        className={`${size} shrink-0 rounded-full object-cover ring-1 ring-white/80 dark:ring-slate-900/80`}
      />
    );
  }

  return (
    <span
      className={[
        size,
        'flex shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white ring-1 ring-white/80 dark:ring-slate-900/80',
        colorFor(peer.userId || peer.userName),
      ].join(' ')}
    >
      {initials(peer.userName)}
    </span>
  );
};

export const EditingNowBadge: React.FC<EditingNowBadgeProps> = ({ peers, compact = false, className }) => {
  // A foto não vem junto com a presença (seria um `data:` de megabytes no
  // websocket): é buscada aqui pelo id, uma vez por sessão.
  const avatarOf = useUserAvatars(peers.map((peer) => peer.userId));

  if (peers.length === 0) return null;
  const isTyping = peers.some((peer) => peer.typing);
  const faceSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4';

  return (
    <span
      title={tooltip(peers)}
      className={[
        'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium',
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        isTyping
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/30 dark:text-emerald-300'
          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/30 dark:text-amber-300',
        className || '',
      ].join(' ')}
    >
      <span className="flex shrink-0 -space-x-1">
        {peers.slice(0, 3).map((peer) => (
          <PeerFace key={peer.userId} peer={peer} avatarUrl={avatarOf(peer.userId)} size={faceSize} />
        ))}
      </span>
      <span className="truncate">{describe(peers, compact)}</span>
    </span>
  );
};

export default EditingNowBadge;
