import React from 'react';
import { Users } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from './ui/Modal';
import { Button } from './ui/Button';
import type { EditingPeer } from '../hooks/useNextcloudPresence';
import { useUserAvatars } from '../hooks/useUserAvatars';
import { LAYER } from '../styles/layers';

/**
 * EditingNowPeopleModal
 * -----------------------------------------------------------------------------
 * "Este documento já está aberto por outra pessoa" — na hora de abrir.
 *
 * Substituiu um `window.confirm`: caixa cinza do navegador, texto corrido, sem
 * foto e sem dizer o que muda ao abrir junto. Aqui a pessoa aparece com a FOTO e
 * o nome, e o texto diz a verdade dos dois cenários:
 *
 *  - com co-edição ligada, abrir junto é o comportamento esperado (as edições se
 *    encontram no mesmo documento);
 *  - sem co-edição, cada um fica com a sua cópia e quem salvar por último
 *    sobrescreve o outro. Este é o caso em que vale pensar duas vezes.
 */

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

function since(peer: EditingPeer): string {
  const minutes = Math.max(0, Math.round((Date.now() - peer.since) / 60000));
  if (minutes < 1) return 'abriu agora há pouco';
  if (minutes === 1) return 'abriu há 1 minuto';
  if (minutes < 60) return `abriu há ${minutes} minutos`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? 'abriu há 1 hora' : `abriu há ${hours} horas`;
}

const PeerRow: React.FC<{ peer: EditingPeer; avatarUrl: string | null }> = ({ peer, avatarUrl }) => {
  const [brokenImage, setBrokenImage] = React.useState(false);
  const showPhoto = Boolean(avatarUrl) && !brokenImage;

  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
        {showPhoto ? (
          <img
            src={avatarUrl as string}
            alt={peer.userName}
            loading="lazy"
            decoding="async"
            onError={() => setBrokenImage(true)}
            className="h-full w-full rounded-full object-cover"
          />
        ) : (
          <span
            className={[
              'flex h-full w-full items-center justify-center rounded-full text-xs font-bold text-white',
              colorFor(peer.userId || peer.userName),
            ].join(' ')}
          >
            {initials(peer.userName)}
          </span>
        )}
        {peer.typing && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-800" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {peer.userName}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {peer.typing ? 'digitando neste instante' : since(peer)}
        </span>
      </span>
    </li>
  );
};

interface EditingNowPeopleModalProps {
  open: boolean;
  fileName: string;
  peers: EditingPeer[];
  /** `true` quando o serviço de co-edição está configurado. */
  collabAvailable: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const EditingNowPeopleModal: React.FC<EditingNowPeopleModalProps> = ({
  open,
  fileName,
  peers,
  collabAvailable,
  onCancel,
  onConfirm,
}) => {
  // A foto é resolvida pelo id: a presença carrega só o essencial.
  const avatarOf = useUserAvatars(peers.map((peer) => peer.userId));
  const plural = peers.length > 1;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      title={plural ? 'Este documento já está aberto por outras pessoas' : 'Este documento já está aberto'}
      eyebrow="Nextcloud"
      subtitle={fileName}
      icon={<Users className="h-5 w-5" />}
      accentBarClassName={collabAvailable ? 'bg-blue-600' : 'bg-amber-500'}
      iconContainerClassName={
        collabAvailable
          ? 'rounded-xl bg-blue-600 text-white shadow-sm'
          : 'rounded-xl bg-amber-500 text-white shadow-sm'
      }
      zIndex={LAYER.MODAL_NESTED}
      footer={
        <ModalFooter>
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button onClick={onConfirm}>
            {collabAvailable ? 'Abrir e editar junto' : 'Abrir mesmo assim'}
          </Button>
        </ModalFooter>
      }
    >
      <ModalBody>
        <ul className="space-y-2">
          {peers.map((peer) => (
            <PeerRow key={peer.userId} peer={peer} avatarUrl={avatarOf(peer.userId)} />
          ))}
        </ul>

        {collabAvailable ? (
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Podem editar ao mesmo tempo: o texto {plural ? 'delas' : 'da pessoa'} aparece na sua
            tela e o seu aparece na {plural ? 'delas' : 'dela'}, sem precisar salvar. O documento no
            Nextcloud é gravado com as edições de todo mundo.
          </p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            A edição em conjunto não está ligada neste ambiente: cada um vai trabalhar em uma
            cópia própria e <strong className="text-slate-800 dark:text-slate-100">quem salvar por
            último apaga o trabalho do outro</strong>. Combine antes quem vai mexer no arquivo.
          </p>
        )}
      </ModalBody>
    </Modal>
  );
};

export default EditingNowPeopleModal;
