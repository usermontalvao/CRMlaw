/**
 * ClientAvatar — Avatar do cliente no Portal.
 *
 * Mostra a foto real do cliente (pinada em `clients.photo_path`) com signed URL.
 * Se a foto falhar ao carregar (URL expirada, sem foto, etc), faz fallback
 * gracioso para as iniciais sobre um gradiente.
 *
 * Quando o link signed expira (após 1h), tenta renovar automaticamente uma vez
 * via `clientAuthService.refreshSessionPhoto()`.
 */
import React, { useEffect, useState } from 'react';
import { useClientAuth } from '../contexts/ClientAuthContext';
import { clientAuthService } from '../services/clientAuth.service';

interface Props {
  size?: number; // px
  className?: string;
  rounded?: 'full' | 'xl' | '2xl' | '3xl';
  ring?: boolean;
}

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || 'C'
  );
}

const ROUNDED: Record<NonNullable<Props['rounded']>, string> = {
  full: 'rounded-full',
  xl: 'rounded-xl',
  '2xl': 'rounded-2xl',
  '3xl': 'rounded-3xl',
};

export const ClientAvatar: React.FC<Props> = ({
  size = 40,
  className = '',
  rounded = 'full',
  ring = false,
}) => {
  const { session, updateSession } = useClientAuth();
  const [imgError, setImgError] = useState(false);
  const [retried, setRetried] = useState(false);

  const name = session?.client.nome || 'Cliente';
  const initials = getInitials(name);
  const photoUrl = session?.client.photo_url || null;

  // Tenta renovar a URL uma vez se falhou ao carregar (expirou)
  useEffect(() => {
    if (!imgError || retried || !session?.client.photo_path) return;
    setRetried(true);
    clientAuthService.refreshSessionPhoto().then((newUrl) => {
      if (newUrl && updateSession) {
        updateSession((prev) =>
          prev ? { ...prev, client: { ...prev.client, photo_url: newUrl } } : prev
        );
        setImgError(false);
      }
    });
  }, [imgError, retried, session?.client.photo_path, updateSession]);

  const showImage = photoUrl && !imgError;

  const dim = { width: size, height: size };
  const fontSize = Math.max(11, Math.round(size * 0.38));

  return (
    <div
      style={dim}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-orange-500 to-amber-500 font-bold text-white shadow-sm ${
        ROUNDED[rounded]
      } ${ring ? 'ring-4 ring-white' : ''} ${className}`}
    >
      {showImage ? (
        <img
          src={photoUrl as string}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
          draggable={false}
        />
      ) : (
        <span style={{ fontSize }} className="select-none tracking-wide">
          {initials}
        </span>
      )}
    </div>
  );
};

export default ClientAvatar;
