// O SELO DE QUEM É ADVOGADO OU ADMINISTRADOR.
//
// Saiu de dentro de `ChatFloatingWidget` (três mil linhas) porque agora ele é
// usado também pela linha da lista de conversas da equipe, que virou peça
// própria — e porque um átomo de dez linhas não precisa carregar junto o
// arquivo inteiro do painel para ser lido.
import React from 'react';
import { BadgeCheck } from 'lucide-react';
import type { Profile } from '../../services/profile.service';

export type VerifiedVariant = 'admin' | 'lawyer';

export const getVerifiedVariant = (profile: Pick<Profile, 'role' | 'oab'> | null | undefined): VerifiedVariant | null => {
  if (!profile) return null;
  const role = String(profile.role || '').toLowerCase();
  const oab = (profile.oab ?? '').trim();

  if (role.includes('admin') || role.includes('administrador')) return 'admin';
  if (role.includes('advog') || role.includes('advogado') || !!oab) return 'lawyer';
  return null;
};

export const VerifiedBadge: React.FC<{ variant: VerifiedVariant }> = ({ variant }) => {
  const isAdmin = variant === 'admin';
  const title = isAdmin ? 'Administrador verificado' : 'Advogado verificado';
  const cls = isAdmin
    ? 'bg-amber-400 text-amber-950 ring-1 ring-amber-200/40'
    : 'bg-sky-500 text-white ring-1 ring-sky-300/40';

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center h-[18px] w-[18px] rounded-full ${cls} shrink-0`}
      aria-label={title}
    >
      <BadgeCheck className="w-3.5 h-3.5" />
    </span>
  );
};
