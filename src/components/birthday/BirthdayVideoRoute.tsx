import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Play } from 'lucide-react';
import BirthdayVideo from './BirthdayVideo';
import { supabase } from '../../config/supabase';
import { birthdayService } from '../../services/birthday.service';
import { getFirstName, getInitials, getLocalDateKey } from '../../utils/birthday';

/**
 * Rota de visualização do vídeo de aniversário — "?aniversarioanimado".
 *
 * Serve para assistir/conferir a peça a qualquer momento, sem esperar a data.
 * Nada aqui grava no banco: é só reprodução (a celebração "de verdade" só é
 * marcada como vista quando a pessoa abre o aviso de correspondência no CRM).
 *
 * Se houver sessão ativa, usa nome, foto e data reais de quem está logado.
 * Dá para forçar valores pela URL:
 *   ?aniversarioanimado=1&nome=Ana%20Souza&nascimento=1992-07-30&foto=https://...
 */

type PersonData = {
  name: string;
  avatarUrl: string | null;
  birthDate: string | null;
};

function readOverrides(): Partial<PersonData> {
  const params = new URLSearchParams(window.location.search);
  const overrides: Partial<PersonData> = {};
  const name = params.get('nome');
  const photo = params.get('foto');
  const birth = params.get('nascimento');
  if (name) overrides.name = name;
  if (photo) overrides.avatarUrl = photo;
  if (birth) overrides.birthDate = birth;
  return overrides;
}

function demoBirthDate(): string {
  const today = new Date();
  return getLocalDateKey(new Date(today.getFullYear() - 32, today.getMonth(), today.getDate()));
}

export default function BirthdayVideoRoute() {
  const [person, setPerson] = useState<PersonData | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const overrides = readOverrides();
      const fallback: PersonData = {
        name: 'Pedro Rodrigues',
        avatarUrl: null,
        birthDate: demoBirthDate(),
      };

      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user;
        if (user) {
          const [{ data: profile }, record] = await Promise.all([
            supabase.from('profiles').select('name, avatar_url').eq('user_id', user.id).maybeSingle(),
            birthdayService.getMyBirthday(user.id).catch(() => ({ birthDate: null, celebratedYear: null })),
          ]);

          fallback.name = profile?.name || user.user_metadata?.full_name || user.email || fallback.name;
          fallback.avatarUrl = profile?.avatar_url || null;
          fallback.birthDate = record.birthDate || fallback.birthDate;
        }
      } catch {
        // Sem sessão ou sem rede: segue com os dados de demonstração.
      }

      if (!cancelled) setPerson({ ...fallback, ...overrides });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!person) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#07040f] text-white/60">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (playing) {
    return (
      <BirthdayVideo
        personName={person.name}
        avatarUrl={person.avatarUrl}
        birthDate={person.birthDate}
        onClose={() => setPlaying(false)}
      />
    );
  }

  // Capa: além de servir de "poster", o clique aqui é o gesto que os
  // navegadores exigem para liberar o áudio da trilha.
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07040f] px-6 py-12 text-white">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <motion.div
          className="absolute -left-40 -top-40 h-[38rem] w-[38rem] rounded-full bg-orange-500/25 blur-[130px]"
          animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-48 -right-32 h-[42rem] w-[42rem] rounded-full bg-fuchsia-600/25 blur-[150px]"
          animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.75)_100%)]" />
      </div>

      <motion.div
        className="relative w-full max-w-lg text-center"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <div className="relative mx-auto mb-8 h-32 w-32">
          <motion.div
            className="absolute -inset-[7px] rounded-full"
            style={{
              background:
                'conic-gradient(from 0deg, #fbbf24, #fb7185, #a78bfa, #38bdf8, #34d399, #fbbf24)',
              filter: 'blur(1.5px)',
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
          />
          <div className="absolute inset-0 overflow-hidden rounded-full border-[3px] border-[#07040f]">
            {person.avatarUrl ? (
              <img
                src={person.avatarUrl}
                alt={person.name}
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="font-birthday-display flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-4xl font-semibold">
                {getInitials(person.name)}
              </div>
            )}
          </div>
        </div>

        <h1 className="birthday-gradient-text font-birthday-display bg-gradient-to-r from-amber-100 via-white to-rose-100 bg-clip-text text-[clamp(2rem,7vw,3.6rem)] font-semibold leading-tight tracking-[-0.035em] text-transparent">
          Feliz aniversário, {getFirstName(person.name)}
        </h1>
        <p className="font-birthday-display mx-auto mt-4 max-w-md text-[15px] italic leading-relaxed text-white/55">
          48 segundos, com trilha sonora e legendas. Ative o som para a experiência completa.
        </p>

        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="font-birthday-kicker group mx-auto mt-9 inline-flex h-14 items-center justify-center gap-3 rounded-full bg-white px-8 text-sm font-semibold uppercase tracking-[0.14em] text-[#2a123d] shadow-[0_18px_50px_rgba(255,255,255,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(255,255,255,0.32)]"
        >
          <Play className="h-5 w-5 fill-current transition group-hover:scale-110" />
          Assistir
        </button>
      </motion.div>
    </div>
  );
}
