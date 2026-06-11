import React from 'react';
import { Building2 } from 'lucide-react';

/**
 * Avatar de cliente reutilizável em todo o sistema.
 * Prioridade: foto real → ícone PJ → iniciais coloridas determinísticas.
 */

type ClientLike = {
  full_name?: string | null;
  client_type?: string | null;
};

const stringToHue = (s: string): number => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash << 5) - hash + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
};

const getInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

interface ClientAvatarProps {
  client?: ClientLike | null;
  photoUrl?: string;
  size?: number;
  className?: string;
}

export const ClientAvatar: React.FC<ClientAvatarProps> = ({
  client,
  photoUrl,
  size = 40,
  className = '',
}) => {
  const name = client?.full_name || 'Cliente';
  const isPj = client?.client_type === 'pessoa_juridica';

  if (photoUrl) {
    return (
      <div
        className={`flex-shrink-0 rounded-full overflow-hidden ring-1 ring-slate-200 shadow-sm bg-slate-100 ${className}`}
        style={{ width: size, height: size }}
      >
        <img src={photoUrl} alt={name} className="w-full h-full object-cover" />
      </div>
    );
  }

  if (isPj) {
    return (
      <div
        className={`flex-shrink-0 rounded-full bg-slate-100 border border-[#e7e5df] text-slate-500 flex items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <Building2 style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }

  const hue = stringToHue(name);
  return (
    <div
      className={`flex-shrink-0 rounded-full flex items-center justify-center font-semibold ring-1 ring-inset ${className}`}
      style={
        {
          width: size,
          height: size,
          background: `hsl(${hue}, 55%, 94%)`,
          color: `hsl(${hue}, 50%, 32%)`,
          fontSize: size * 0.38,
          // @ts-ignore inline ring color
          '--tw-ring-color': `hsl(${hue}, 50%, 80%)`,
        } as React.CSSProperties
      }
    >
      {getInitials(name)}
    </div>
  );
};

export default ClientAvatar;
