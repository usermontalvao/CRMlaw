// O AVATAR DO CHAT — foto, ou as iniciais na cor do nome.
//
// Saiu de `ChatFloatingWidget` junto com a linha da lista: os dois são a mesma
// peça vista em dois lugares (a lista e o cabeçalho da conversa), e nenhum dos
// dois precisa do painel inteiro para existir.
import React, { useMemo } from 'react';
import { coresDoNome } from './avatarColors';

export const Avatar: React.FC<{ src?: string | null; name: string; online?: boolean; size?: 'sm' | 'md' | 'lg' }> = ({ src, name, online, size = 'md' }) => {
  const initials = useMemo(() => {
    if (!name) return '?';
    return name
      .split(' ')
      .filter((n) => n.length > 0)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }, [name]);

  const dim = size === 'sm' ? 'h-9 w-9' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10';
  const dotSize = size === 'sm' ? 'h-2.5 w-2.5' : size === 'lg' ? 'h-3 w-3' : 'h-2.5 w-2.5';

  return (
    <div className="relative shrink-0">
      {src ? (
        <img
          src={src}
          alt={name}
          className={`${dim} rounded-full object-cover ring-1 ring-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]`}
        />
      ) : (
        <div
          className={`${dim} rounded-full bg-gradient-to-br from-orange-500 via-amber-500 to-orange-600 flex items-center justify-center text-white text-xs font-bold ring-1 ring-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.3)]`}
        >
          {initials}
        </div>
      )}
      {typeof online === 'boolean' && (
        <span className="absolute bottom-0 right-0 flex items-center justify-center">
          {online && (
            <span className={`absolute ${dotSize} rounded-full bg-emerald-400/60 animate-ping`} />
          )}
          <span
            className={`relative block ${dotSize} rounded-full ring-[2.5px] ring-[#0a0f1c] ${online ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-500'}`}
          />
        </span>
      )}
    </div>
  );
};
