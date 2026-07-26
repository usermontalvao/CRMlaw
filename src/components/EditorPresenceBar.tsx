import React from 'react';
import { describePresence, type CollabStatus } from '../services/collabPresence';

/**
 * EditorPresenceBar
 * -----------------------------------------------------------------------------
 * Quem está com ESTE documento aberto, no canto do papel — no espírito do Google
 * Docs: a FOTO de cada pessoa, e o NOME apenas na frase ("Ana está digitando…").
 *

 * Quem está DIGITANDO aparece identificado EM CIMA DO PRÓPRIO CURSOR, dentro
 * do papel (ver collabCaretFlags.ts) — por isso esta barra é UMA linha só,
 * sem pilha de avisos.
 *
 * Duas coisas que este componente NÃO faz de propósito:
 *  - não inventa "digitando" a partir de presença solta: quem manda no `typing`
 *    é a sala de co-edição (ver `collabPresence.ts`);
 *  - não apresenta presença como prova de sincronia. Quando a co-edição cai, a
 *    barra diz "Coedição desconectada" em vez de continuar mostrando as pessoas
 *    como se tudo estivesse indo e voltando.
 */

/** Cor estável por pessoa — a mesma pessoa tem sempre a mesma cor. */
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-indigo-500',
];

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

export interface PresenceBarPeer {
  /** Chave estável (id da conexão na sala, ou id do usuário na presença). */
  id: string;
  userName: string;
  avatarUrl: string | null;
  typing: boolean;
}

interface EditorPresenceBarProps {
  peers: PresenceBarPeer[];
  /** Estado da co-edição. `disconnected` troca a barra pelo aviso de queda. */
  collabStatus?: CollabStatus;
  className?: string;
}

const MAX_VISIBLE = 4;

const PeerAvatar: React.FC<{ peer: PresenceBarPeer }> = ({ peer }) => {
  const [brokenImage, setBrokenImage] = React.useState(false);
  const showPhoto = Boolean(peer.avatarUrl) && !brokenImage;

  return (
    <span
      className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ring-white dark:ring-slate-900"
      title={`${peer.userName}${peer.typing ? ' — digitando agora' : ' — com o documento aberto'}`}
    >
      {showPhoto ? (
        <img
          src={peer.avatarUrl as string}
          alt={peer.userName}
          loading="lazy"
          decoding="async"
          onError={() => setBrokenImage(true)}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          className={[
            'flex h-full w-full items-center justify-center rounded-full text-[10px] font-bold text-white',
            colorFor(peer.id || peer.userName),
          ].join(' ')}
        >
          {initials(peer.userName)}
        </span>
      )}
      {peer.typing && (
        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />
      )}
    </span>
  );
};

export const EditorPresenceBar: React.FC<EditorPresenceBarProps> = ({
  peers,
  collabStatus = 'off',
  className,
}) => {
  const shellClass = [
    'pointer-events-auto flex items-center gap-2 rounded-full border px-2 py-1 shadow-[0_6px_20px_rgba(15,23,42,0.12)] backdrop-blur',
    className || '',
  ].join(' ');

  // A queda da co-edição tem prioridade sobre a lista: mostrar as pessoas aqui
  // enquanto nada sincroniza é justamente a mentira que queremos evitar.
  if (collabStatus === 'disconnected') {
    return (
      <div
        className={`${shellClass} border-rose-200 bg-rose-50/95 dark:border-rose-900/60 dark:bg-rose-950/80`}
        title="As edições pararam de ser enviadas ao servidor. O que você escreveu continua aqui; reabra o documento para voltar a editar junto."
      >
        <span className="flex h-2 w-2 shrink-0 rounded-full bg-rose-500" />
        <span className="pr-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
          Coedição desconectada — suas alterações estão salvas só aqui
        </span>
      </div>
    );
  }

  if (collabStatus === 'reconnecting') {
    return (
      <div
        className={`${shellClass} border-amber-200 bg-amber-50/95 dark:border-amber-900/60 dark:bg-amber-950/80`}
        title="A conexão da coedição caiu e está sendo restabelecida. Nada do que você digitou foi perdido."
      >
        <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-500" />
        <span className="pr-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
          Reconectando à coedição…
        </span>
      </div>
    );
  }

  if (peers.length === 0) return null;

  const visible = peers.slice(0, MAX_VISIBLE);
  const overflow = peers.length - visible.length;

  // UM elemento só, enxuto. O "fulano está digitando" NÃO mora mais aqui: ele
  // aparece em cima do cursor da própria pessoa, dentro do papel (ver
  // collabCaretFlags.ts). Aqui fica apenas quem está no documento — a foto na
  // frente e a frase curta — para a barra não virar uma pilha de avisos.
  const presenceOnly = peers.map((peer) => ({ ...peer, typing: false }));

  return (
    <div
      className={`${shellClass} border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-slate-900/95`}
      title={peers
        .map((peer) => `${peer.userName}${peer.typing ? ' — digitando agora' : ' — com o documento aberto'}`)
        .join('\n')}
    >
      <div className="flex -space-x-2">
        {visible.map((peer) => (
          <PeerAvatar key={peer.id} peer={peer} />
        ))}
        {overflow > 0 && (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-600 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-900">
            +{overflow}
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 pr-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
        {describePresence(presenceOnly)}
      </span>
    </div>
  );
};

export default EditorPresenceBar;
