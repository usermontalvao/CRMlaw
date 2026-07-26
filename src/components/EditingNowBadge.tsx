import React from 'react';
import type { EditingPeer } from '../hooks/useNextcloudPresence';

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

export const EditingNowBadge: React.FC<EditingNowBadgeProps> = ({ peers, compact = false, className }) => {
  if (peers.length === 0) return null;
  const isTyping = peers.some((peer) => peer.typing);

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
      <span className="relative flex h-2 w-2 shrink-0">
        <span
          className={[
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-70',
            isTyping ? 'bg-emerald-400' : 'bg-amber-400',
          ].join(' ')}
        />
        <span
          className={[
            'relative inline-flex h-2 w-2 rounded-full',
            isTyping ? 'bg-emerald-500' : 'bg-amber-500',
          ].join(' ')}
        />
      </span>
      <span className="truncate">{describe(peers, compact)}</span>
    </span>
  );
};

export default EditingNowBadge;
