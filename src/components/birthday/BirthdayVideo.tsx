import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import ConfettiCanvas, { type ConfettiHandle } from './ConfettiCanvas';
import BokehCanvas from './BokehCanvas';
import { BEAT, BirthdayMusic, MUSIC_CLIMAX_BEAT } from './birthdayMusic';
import { formatDayAndMonth, getAge, getFirstName, getInitials } from '../../utils/birthday';

/**
 * "Vídeo" de aniversário — não é um arquivo de mídia, é uma sequência animada
 * renderizada ao vivo com a foto e o nome da pessoa (no espírito dos vídeos de
 * aniversário do Facebook). Cenas e legendas andam por um relógio próprio, em
 * segundos, que só para quando a pessoa pausa — nunca junto com o áudio, que o
 * navegador suspende sozinho em várias situações (aba oculta, tela bloqueada).
 *
 * Tipografia: Spectral (serif editorial) nos títulos e Space Grotesk nos
 * rótulos — as duas já vêm carregadas pelo index.html.
 */

type BirthdayVideoProps = {
  personName?: string | null;
  avatarUrl?: string | null;
  birthDate?: string | null;
  /** 0 = no dia; maior que 0 = recuperação, e as legendas param de dizer "hoje". */
  daysSince?: number;
  /** Assinatura exibida no final. */
  teamName?: string;
  onClose: () => void;
};

type Scene = { id: string; start: number };

// Tempos em "beats" da trilha (1 beat = 0,6 s), para que cada virada de cena
// caia exatamente num ponto forte da música.
const SCENES: Scene[] = [
  { id: 'abertura', start: 0 },
  { id: 'data', start: BEAT * 11 }, // 6,6 s
  { id: 'foto', start: BEAT * 22 }, // 13,2 s
  { id: 'idade', start: BEAT * 36 }, // 21,6 s
  { id: 'titulo', start: BEAT * MUSIC_CLIMAX_BEAT }, // 27,6 s — tutti
  { id: 'mensagem', start: BEAT * 62 }, // 37,2 s
  { id: 'final', start: BEAT * 74 }, // 44,4 s
];

const VIDEO_DURATION = BEAT * 80; // 48 s

type Subtitle = { from: number; to: number; text: string };

function buildSubtitles(
  firstName: string,
  dayAndMonth: string,
  age: number | null,
  late: boolean,
): Subtitle[] {
  const lines: Subtitle[] = [
    { from: 0.8, to: 3.6, text: 'Todo dia este sistema registra prazos, processos e audiências.' },
    {
      from: 3.9,
      to: 6.4,
      text: late
        ? 'Mas guardou uma data que não podia passar em branco.'
        : 'Hoje ele guarda uma data diferente.',
    },
    {
      from: 7.0,
      to: 12.9,
      text: dayAndMonth ? `${dayAndMonth}. O dia em que tudo começou.` : 'O dia em que tudo começou.',
    },
    { from: 13.6, to: 17.2, text: 'E essa data tem nome e rosto.' },
    {
      from: 17.6,
      to: 21.3,
      text: late ? `${firstName}, o dia foi seu.` : `${firstName}, hoje o dia é seu.`,
    },
  ];

  lines.push(
    age !== null
      ? { from: 22.0, to: 27.2, text: `${age} voltas ao redor do sol, e uma história em cada uma delas.` }
      : { from: 22.0, to: 27.2, text: 'Mais um ciclo se completa hoje.' },
  );

  lines.push(
    { from: 28.0, to: 36.9, text: `Feliz aniversário, ${firstName}!` },
    { from: 37.6, to: 44.0, text: 'Que o novo ciclo venha cheio de conquistas — e de bons motivos para comemorar.' },
    { from: 44.8, to: 47.8, text: 'Com carinho, de toda a equipe.' },
  );

  return lines;
}

const MONTHS_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

// -------------------------------------------------------------------------
// Peças reutilizáveis
// -------------------------------------------------------------------------

function AvatarOrb({
  avatarUrl,
  personName,
  size,
  ringSpeed = 9,
}: {
  avatarUrl?: string | null;
  personName?: string | null;
  size: number;
  ringSpeed?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(avatarUrl) && !failed;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <motion.div
        className="absolute -inset-[6px] rounded-full opacity-90"
        style={{
          background:
            'conic-gradient(from 0deg, rgba(251,191,36,.95), rgba(255,255,255,.9), rgba(251,146,60,.9), rgba(244,114,182,.85), rgba(251,191,36,.95))',
          filter: 'blur(1.2px)',
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: ringSpeed, ease: 'linear', repeat: Infinity }}
      />
      <div className="absolute inset-0 overflow-hidden rounded-full border-[3px] border-[#0b0616] shadow-[0_25px_80px_rgba(251,191,36,0.3)]">
        {showImage ? (
          <img
            src={avatarUrl as string}
            alt={personName || 'Foto de perfil'}
            onError={() => setFailed(true)}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            className="font-birthday-display flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 font-semibold text-white"
            style={{ fontSize: size * 0.32 }}
          >
            {getInitials(personName)}
          </div>
        )}
        <motion.div
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/30 to-transparent"
          animate={{ x: ['0%', '400%'] }}
          transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2.6 }}
        />
      </div>
    </div>
  );
}

/**
 * Texto que entra pedaço a pedaço. As letras são sempre agrupadas por palavra
 * dentro de um inline-block, senão a quebra de linha corta a palavra ao meio.
 */
function StaggerText({
  text,
  className,
  pieceClassName,
  delay = 0,
  step = 0.045,
  by = 'char',
}: {
  text: string;
  className?: string;
  /**
   * Classe aplicada a CADA pedaço. É o único lugar onde um gradiente com
   * `background-clip: text` funciona: no wrapper, deixaria o texto dos filhos
   * transparente (e portanto invisível).
   */
  pieceClassName?: string;
  delay?: number;
  step?: number;
  by?: 'char' | 'word';
}) {
  const words = text.split(' ');
  let pieceIndex = 0;

  return (
    <span className={className} aria-label={text} style={{ perspective: 900 }}>
      {words.map((word, wordIndex) => {
        const pieces = by === 'word' ? [word] : Array.from(word);
        const rendered = (
          <span className="inline-block" aria-hidden="true">
            {pieces.map((piece) => {
              const index = pieceIndex;
              pieceIndex += 1;
              return (
                <motion.span
                  key={index}
                  className={`inline-block${pieceClassName ? ` ${pieceClassName}` : ''}`}
                  style={pieceClassName ? { animationDelay: `${index * 0.05}s` } : undefined}
                  initial={{ opacity: 0, y: '0.4em', rotateX: -65, filter: 'blur(6px)' }}
                  animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
                  transition={{ delay: delay + index * step, duration: 0.75, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  {piece}
                </motion.span>
              );
            })}
          </span>
        );
        // O espaço conta no ritmo do stagger, mas fica FORA do inline-block
        // para que a linha ainda possa quebrar entre palavras.
        pieceIndex += 1;
        return (
          <Fragment key={`${word}-${wordIndex}`}>
            {rendered}
            {wordIndex < words.length - 1 ? ' ' : ''}
          </Fragment>
        );
      })}
    </span>
  );
}

/**
 * Tamanho em px que cabe na tela. Dimensionar só por largura estoura a altura
 * em celular deitado, então a altura entra na conta junto.
 */
function useFitSize(max: number, widthFactor: number, heightFactor: number, min: number) {
  const [size, setSize] = useState(max);

  useEffect(() => {
    const update = () =>
      setSize(
        Math.round(
          Math.max(min, Math.min(max, window.innerWidth * widthFactor, window.innerHeight * heightFactor)),
        ),
      );
    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [max, widthFactor, heightFactor, min]);

  return size;
}

function Kicker({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.p
      className="font-birthday-kicker text-[clamp(0.6rem,1.5vw,0.78rem)] font-medium uppercase tracking-[0.52em] text-amber-200/70"
      initial={{ opacity: 0, letterSpacing: '0.9em' }}
      animate={{ opacity: 1, letterSpacing: '0.52em' }}
      transition={{ delay, duration: 1.3, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.p>
  );
}

function HairLine({ delay = 0, width = 'min(62vw, 420px)' }: { delay?: number; width?: string }) {
  return (
    <motion.div
      className="mx-auto h-px bg-gradient-to-r from-transparent via-amber-200/70 to-transparent"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      transition={{ delay, duration: 1.5, ease: [0.2, 0.8, 0.2, 1] }}
    />
  );
}

function LightRays() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => (
        <motion.span
          key={index}
          className="absolute left-1/2 top-1/2 origin-bottom"
          style={{
            width: 1 + (index % 3),
            height: '85vmax',
            background:
              'linear-gradient(to top, rgba(251,191,36,0), rgba(251,191,36,0.35), rgba(251,191,36,0))',
            rotate: `${index * 51}deg`,
            translateX: '-50%',
            translateY: '-100%',
          }}
          animate={{ opacity: [0.04, 0.22, 0.04], scaleY: [0.92, 1.06, 0.92] }}
          transition={{ duration: 6 + index * 0.5, repeat: Infinity, ease: 'easeInOut', delay: index * 0.3 }}
        />
      ))}
    </div>
  );
}

function FloatingBalloons() {
  const balloons = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => ({
        id: index,
        left: 4 + ((index * 37) % 90),
        delay: -(index % 6) * 1.8,
        duration: 13 + (index % 5) * 1.8,
        scale: 0.3 + (index % 4) * 0.09,
        colors: [
          ['#fbbf24', '#d97706'],
          ['#fb7185', '#be123c'],
          ['#f5f5f4', '#a8a29e'],
          ['#c084fc', '#6d28d9'],
        ][index % 4],
      })),
    [],
  );

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60" aria-hidden="true">
      {balloons.map((balloon) => (
        <motion.div
          key={balloon.id}
          className="absolute bottom-[-22vh]"
          style={{ left: `${balloon.left}%`, scale: balloon.scale }}
          animate={{ y: ['0vh', '-135vh'], x: [0, 24, -16, 10], rotate: [-4, 4, -3, 3] }}
          transition={{ duration: balloon.duration, delay: balloon.delay, repeat: Infinity, ease: 'linear' }}
        >
          <div
            className="relative h-24 w-20 rounded-[50%_50%_46%_46%] shadow-[inset_-10px_-14px_20px_rgba(0,0,0,0.22)]"
            style={{ background: `linear-gradient(150deg, ${balloon.colors[0]}, ${balloon.colors[1]})` }}
          >
            <span className="absolute left-4 top-4 h-6 w-3 rotate-[-20deg] rounded-full bg-white/40 blur-[1px]" />
          </div>
          <span className="mx-auto block h-24 w-px bg-white/20" />
        </motion.div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------
// Cenas
// -------------------------------------------------------------------------

const sceneTransition = { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] as const };

function SceneWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center px-5 text-center sm:px-8"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, filter: 'blur(10px)', transition: { duration: 0.5, ease: 'easeIn' } }}
      transition={sceneTransition}
    >
      {children}
    </motion.div>
  );
}

function OpeningScene({ todayLabel, late }: { todayLabel: string; late: boolean }) {
  return (
    <SceneWrapper>
      <LightRays />
      <div className="relative w-full max-w-3xl">
        <Kicker delay={0.2}>{todayLabel}</Kicker>

        <div className="my-7">
          <HairLine delay={0.5} />
        </div>

        <StaggerText
          text={late ? 'Essa data não' : 'Hoje não é'}
          by="word"
          delay={0.9}
          step={0.14}
          className="font-birthday-display block text-[clamp(1.9rem,min(8vw,7.5vh),5.4rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-white"
        />
        <StaggerText
          text={late ? 'podia passar batido.' : 'um dia comum.'}
          by="word"
          delay={1.5}
          step={0.14}
          className="font-birthday-display block text-[clamp(1.9rem,min(8vw,7.5vh),5.4rem)] font-semibold italic leading-[1.08] tracking-[-0.025em] text-amber-100/90"
        />

        <div className="mt-8">
          <HairLine delay={0.8} width="min(38vw, 240px)" />
        </div>
      </div>
    </SceneWrapper>
  );
}

function DateScene({ birthDate }: { birthDate?: string | null }) {
  const parsed = useMemo(() => {
    const match = String(birthDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return { day: Number(match[3]), month: Number(match[2]), year: Number(match[1]) };
  }, [birthDate]);

  return (
    <SceneWrapper>
      <div className="relative w-full max-w-4xl">
        {parsed ? (
          <>
            <Kicker delay={0.1}>Onde tudo começou</Kicker>

            <div className="mt-8 flex items-baseline justify-center gap-5 sm:gap-8">
              <motion.span
                className="birthday-gradient-text font-birthday-numeral bg-gradient-to-b from-white via-amber-50 to-amber-200/70 bg-clip-text text-[clamp(3.5rem,min(20vw,19vh),14rem)] font-semibold leading-[0.85] tracking-[-0.05em] text-transparent"
                initial={{ opacity: 0, y: 70, rotateX: 55 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ delay: 0.4, duration: 1, ease: [0.2, 0.9, 0.2, 1.05] }}
              >
                {parsed.day}
              </motion.span>

              <motion.div
                className="text-left"
                initial={{ opacity: 0, x: -26 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.95, duration: 0.9 }}
              >
                <span className="font-birthday-display block text-[clamp(1.3rem,min(5.5vw,5vh),3.4rem)] font-medium italic leading-none tracking-tight text-white">
                  {MONTHS_PT[parsed.month - 1]}
                </span>
                <span className="font-birthday-kicker mt-2 block text-[clamp(0.65rem,1.8vw,1rem)] font-medium tracking-[0.42em] text-amber-200/65">
                  {parsed.year}
                </span>
              </motion.div>
            </div>

            <div className="mt-10">
              <HairLine delay={1.5} width="min(44vw, 300px)" />
            </div>
          </>
        ) : (
          <StaggerText
            text="Hoje"
            className="font-birthday-display block text-[clamp(2.4rem,min(12vw,11vh),8rem)] font-semibold text-white"
          />
        )}
      </div>
    </SceneWrapper>
  );
}

function PhotoScene({ avatarUrl, fullName }: { avatarUrl?: string | null; fullName: string }) {
  const size = useFitSize(248, 0.42, 0.3, 116);

  return (
    <SceneWrapper>
      <div className="relative flex flex-col items-center">
        {[0, 1, 2].map((index) => (
          <motion.div
            key={index}
            className="absolute top-0 rounded-full border border-amber-200/25"
            style={{ height: size, width: size }}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: [0.9, 2.1], opacity: [0.5, 0] }}
            transition={{ duration: 3.6, repeat: Infinity, delay: index * 1.2, ease: 'easeOut' }}
            aria-hidden="true"
          />
        ))}

        <motion.div
          initial={{ scale: 0.35, opacity: 0, rotate: -10 }}
          animate={{ scale: 1, opacity: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 130, damping: 15, mass: 0.9 }}
        >
          <AvatarOrb avatarUrl={avatarUrl} personName={fullName} size={size} />
        </motion.div>

        <div className="mt-9">
          <Kicker delay={1.0}>O aniversariante de hoje</Kicker>
        </div>

        <StaggerText
          text={fullName}
          by="word"
          delay={1.35}
          step={0.13}
          className="font-birthday-display mt-4 block max-w-4xl text-[clamp(1.5rem,min(6.5vw,6vh),4.2rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-white"
        />

        <div className="mt-7">
          <HairLine delay={2.0} width="min(46vw, 320px)" />
        </div>
      </div>
    </SceneWrapper>
  );
}

function AgeScene({
  age,
  avatarUrl,
  fullName,
  paused,
}: {
  age: number | null;
  avatarUrl?: string | null;
  fullName: string;
  paused: boolean;
}) {
  const [displayed, setDisplayed] = useState(0);
  const avatarSize = useFitSize(88, 0.24, 0.12, 54);

  useEffect(() => {
    if (age === null || paused) return;
    let frame = 0;
    const startedAt = performance.now();
    const duration = 2000;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      // Desacelera no fim (easeOutCubic) para o número "assentar".
      const eased = 1 - (1 - progress) ** 3;
      setDisplayed(Math.round(eased * age));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [age, paused]);

  return (
    <SceneWrapper>
      <div className="relative flex flex-col items-center">
        <motion.div
          className="absolute top-2 h-[clamp(11rem,min(38vw,34vh),23rem)] w-[clamp(11rem,min(38vw,34vh),23rem)] rounded-full border border-white/10"
          animate={{ rotate: 360 }}
          transition={{ duration: 30, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        >
          <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-amber-200 shadow-[0_0_16px_5px_rgba(251,191,36,0.5)]" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="mb-6"
        >
          <AvatarOrb avatarUrl={avatarUrl} personName={fullName} size={avatarSize} ringSpeed={16} />
        </motion.div>

        {age !== null ? (
          <>
            <motion.span
              className="birthday-gradient-text font-birthday-numeral block bg-gradient-to-b from-amber-100 via-white to-amber-200/80 bg-clip-text text-[clamp(4rem,min(24vw,22vh),17rem)] font-semibold leading-[0.82] tracking-[-0.05em] text-transparent"
              initial={{ opacity: 0, scale: 0.65 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 90, damping: 16 }}
            >
              {displayed}
            </motion.span>
            <div className="mt-5">
              <Kicker delay={1.8}>anos</Kicker>
            </div>
          </>
        ) : (
          <span className="font-birthday-display text-[clamp(1.7rem,min(8vw,7.5vh),4.6rem)] font-semibold text-white">
            Mais um ciclo
          </span>
        )}

        <motion.p
          className="font-birthday-display mt-8 max-w-2xl text-[clamp(0.9rem,min(2.3vw,2.2vh),1.45rem)] font-normal italic leading-relaxed text-white/65"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.6, duration: 1.1 }}
        >
          {age !== null
            ? 'e uma história em cada volta ao redor do sol.'
            : 'Um novo ciclo começa exatamente hoje.'}
        </motion.p>
      </div>
    </SceneWrapper>
  );
}

function TitleScene({
  firstName,
  avatarUrl,
  fullName,
}: {
  firstName: string;
  avatarUrl?: string | null;
  fullName: string;
}) {
  const avatarSize = useFitSize(116, 0.3, 0.15, 64);

  return (
    <SceneWrapper>
      <FloatingBalloons />
      <div className="relative flex w-full max-w-5xl flex-col items-center">
        <motion.div
          initial={{ scale: 0, rotate: -24 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 180, damping: 13 }}
          className="mb-7"
        >
          <AvatarOrb avatarUrl={avatarUrl} personName={fullName} size={avatarSize} ringSpeed={7} />
        </motion.div>

        <StaggerText
          text="Feliz"
          delay={0.15}
          step={0.07}
          className="font-birthday-display block text-[clamp(2.2rem,min(12vw,11vh),8.5rem)] font-semibold leading-[0.92] tracking-[-0.045em] text-white drop-shadow-[0_14px_60px_rgba(251,146,60,0.4)]"
        />
        <StaggerText
          text="aniversário,"
          delay={0.5}
          step={0.055}
          pieceClassName="birthday-shimmer"
          className="font-birthday-display block text-[clamp(1.9rem,min(10.5vw,9.5vh),7.4rem)] font-semibold italic leading-[1] tracking-[-0.04em]"
        />

        <motion.p
          className="font-birthday-display mt-5 text-[clamp(1.35rem,min(6.5vw,6vh),3.8rem)] font-semibold tracking-[-0.03em] text-amber-200"
          initial={{ opacity: 0, scale: 0.75, filter: 'blur(12px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ delay: 1.5, type: 'spring', stiffness: 120, damping: 14 }}
        >
          {firstName}
        </motion.p>
      </div>
    </SceneWrapper>
  );
}

function MessageScene({ firstName }: { firstName: string }) {
  return (
    <SceneWrapper>
      <motion.div
        className="relative w-full max-w-3xl"
        initial={{ opacity: 0, y: 44 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <motion.span
          className="font-birthday-display block text-[clamp(2.2rem,min(9vw,8vh),6rem)] leading-none text-amber-200/40"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.9 }}
          aria-hidden="true"
        >
          &ldquo;
        </motion.span>

        <p className="font-birthday-display -mt-4 text-[clamp(1rem,min(3.1vw,2.9vh),2.05rem)] font-normal italic leading-[1.5] text-white/90">
          <StaggerText
            text={`${firstName}, obrigado por cada prazo cumprido, cada cliente bem atendido e cada dia em que você fez diferença por aqui.`}
            by="word"
            step={0.05}
            delay={0.4}
          />
        </p>

        <div className="mt-9">
          <HairLine delay={2.7} width="min(30vw, 180px)" />
        </div>
      </motion.div>
    </SceneWrapper>
  );
}

function FinalScene({
  firstName,
  avatarUrl,
  fullName,
  teamName,
  onReplay,
  onClose,
}: {
  firstName: string;
  avatarUrl?: string | null;
  fullName: string;
  teamName: string;
  onReplay: () => void;
  onClose: () => void;
}) {
  const avatarSize = useFitSize(120, 0.3, 0.16, 64);

  return (
    <SceneWrapper>
      <div className="relative flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 15 }}
        >
          <AvatarOrb avatarUrl={avatarUrl} personName={fullName} size={avatarSize} ringSpeed={11} />
        </motion.div>

        <motion.h2
          className="birthday-gradient-text font-birthday-display mt-8 bg-gradient-to-r from-amber-100 via-white to-rose-100 bg-clip-text text-[clamp(1.55rem,min(6.5vw,6vh),3.8rem)] font-semibold leading-tight tracking-[-0.035em] text-transparent"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.9 }}
        >
          Feliz aniversário, {firstName}
        </motion.h2>

        <div className="mt-5">
          <Kicker delay={0.9}>{teamName}</Kicker>
        </div>

        <motion.div
          className="mt-10 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.3, duration: 0.8 }}
        >
          <button
            type="button"
            onClick={onClose}
            className="font-birthday-kicker inline-flex h-12 items-center justify-center rounded-full bg-white px-8 text-sm font-semibold uppercase tracking-[0.14em] text-[#2a123d] shadow-[0_18px_50px_rgba(255,255,255,0.22)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_60px_rgba(255,255,255,0.32)]"
          >
            Obrigado
          </button>
          <button
            type="button"
            onClick={onReplay}
            className="font-birthday-kicker inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 text-sm font-medium uppercase tracking-[0.14em] text-white/85 backdrop-blur transition hover:bg-white/15"
          >
            <RotateCcw className="h-4 w-4" />
            Rever
          </button>
        </motion.div>
      </div>
    </SceneWrapper>
  );
}

// -------------------------------------------------------------------------
// Player
// -------------------------------------------------------------------------

export default function BirthdayVideo({
  personName,
  avatarUrl,
  birthDate,
  daysSince = 0,
  teamName = 'De toda a equipe',
  onClose,
}: BirthdayVideoProps) {
  const reduceMotion = useReducedMotion();
  const firstName = getFirstName(personName);
  const fullName = String(personName || '').trim() || firstName;
  const age = useMemo(() => getAge(birthDate), [birthDate]);
  const dayAndMonth = useMemo(() => formatDayAndMonth(birthDate), [birthDate]);
  const late = daysSince > 0;
  const subtitles = useMemo(
    () => buildSubtitles(firstName, dayAndMonth, age, late),
    [age, dayAndMonth, firstName, late],
  );
  const todayLabel = useMemo(() => {
    if (late && dayAndMonth) return dayAndMonth;
    const today = new Date();
    return `${today.getDate()} de ${MONTHS_PT[today.getMonth()].toLowerCase()} de ${today.getFullYear()}`;
  }, [dayAndMonth, late]);

  const musicRef = useRef<BirthdayMusic | null>(null);
  const confettiRef = useRef<ConfettiHandle | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const clockRef = useRef<HTMLSpanElement | null>(null);
  const climaxFiredRef = useRef(false);
  const risePlayedRef = useRef(false);
  // Relógio próprio, em segundos. Avança por rAF e só para quando a pessoa
  // pausa — assim o vídeo nunca congela junto com o áudio suspenso.
  const elapsedRef = useRef(0);
  const lastFrameRef = useRef(0);
  const pausedRef = useRef(false);

  const [sceneIndex, setSceneIndex] = useState(0);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [climax, setClimax] = useState(false);

  // Inicia a trilha. Roda logo na montagem porque o componente só é montado a
  // partir de um clique da pessoa, que é o gesto exigido pelos navegadores
  // para liberar o áudio.
  useEffect(() => {
    const music = new BirthdayMusic();
    musicRef.current = music;
    void music.start();
    return () => {
      music.stop();
      musicRef.current = null;
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const music = musicRef.current;
      if (!music) return;

      const now = performance.now();
      const delta = lastFrameRef.current ? (now - lastFrameRef.current) / 1000 : 0;
      lastFrameRef.current = now;

      if (!pausedRef.current) {
        // O clamp protege de saltos quando o rAF fica parado (aba oculta).
        const wall = elapsedRef.current + Math.min(delta, 0.1);
        const audio = music.audioTime();
        // Nunca anda para trás: se o áudio ficou suspenso, ele é que se atrasa.
        elapsedRef.current = audio === null ? wall : Math.max(wall, audio);
      }
      const time = elapsedRef.current;

      if (progressRef.current) {
        progressRef.current.style.width = `${Math.min(100, (time / VIDEO_DURATION) * 100)}%`;
      }
      if (clockRef.current) {
        const remaining = Math.max(0, Math.ceil(VIDEO_DURATION - time));
        clockRef.current.textContent = `0:${String(remaining).padStart(2, '0')}`;
      }

      let nextScene = 0;
      for (let index = SCENES.length - 1; index >= 0; index -= 1) {
        if (time >= SCENES[index].start) {
          nextScene = index;
          break;
        }
      }
      setSceneIndex((current) => {
        if (current === nextScene) return current;
        // Efeito sonoro acompanhando o corte — é o que dá sensação de "vídeo".
        if (nextScene > current) {
          music.cue(SCENES[nextScene].id === 'final' ? 'chime' : 'whoosh');
        }
        return nextScene;
      });

      const active = subtitles.find((line) => time >= line.from && time <= line.to);
      setSubtitle((current) => (current === (active?.text ?? null) ? current : active?.text ?? null));

      if (!risePlayedRef.current && time >= SCENES[4].start - 1.7) {
        risePlayedRef.current = true;
        music.cue('rise');
      }

      if (!climaxFiredRef.current && time >= SCENES[4].start && !reduceMotion) {
        climaxFiredRef.current = true;
        setClimax(true);
        music.cue('impact');
        window.setTimeout(() => musicRef.current?.cue('sparkle'), 260);
        confettiRef.current?.burst({ count: 280, power: 1.1, spread: Math.PI * 1.5 });
        window.setTimeout(
          () => confettiRef.current?.burst({ count: 140, power: 0.85, x: window.innerWidth * 0.2 }),
          420,
        );
        window.setTimeout(
          () => confettiRef.current?.burst({ count: 140, power: 0.85, x: window.innerWidth * 0.8 }),
          760,
        );
        window.setTimeout(() => confettiRef.current?.setRain(true), 1500);
      }

      if (time >= VIDEO_DURATION) setEnded(true);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduceMotion, subtitles]);

  const togglePaused = useCallback(() => {
    setPaused((current) => {
      const next = !current;
      pausedRef.current = next;
      void musicRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      musicRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const replay = useCallback(() => {
    musicRef.current?.stop();
    confettiRef.current?.clear();
    climaxFiredRef.current = false;
    risePlayedRef.current = false;
    setClimax(false);
    elapsedRef.current = 0;
    lastFrameRef.current = 0;
    pausedRef.current = false;
    setEnded(false);
    setPaused(false);
    setSceneIndex(0);
    setSubtitle(null);

    const music = new BirthdayMusic();
    music.setMuted(muted);
    musicRef.current = music;
    void music.start();
  }, [muted]);

  const skipToEnd = useCallback(() => {
    elapsedRef.current = VIDEO_DURATION;
    pausedRef.current = true;
    setEnded(true);
    setSceneIndex(SCENES.length - 1);
    setSubtitle(null);
    void musicRef.current?.setPaused(true);
    if (!reduceMotion) confettiRef.current?.setRain(true);
  }, [reduceMotion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === ' ') {
        event.preventDefault();
        togglePaused();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, togglePaused]);

  // Ao voltar para a aba, o navegador pode ter suspendido o áudio por conta
  // própria. Como o vídeo continuou andando no relógio dele, basta retomar o
  // som — sem mexer no estado de pausa, que é decisão da pessoa.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !pausedRef.current) {
        musicRef.current?.resumeIfSuspended();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  const showFinal = ended || sceneIndex === SCENES.length - 1;

  const scene = (() => {
    if (showFinal) {
      return (
        <FinalScene
          key="final"
          firstName={firstName}
          fullName={fullName}
          avatarUrl={avatarUrl}
          teamName={teamName}
          onReplay={replay}
          onClose={onClose}
        />
      );
    }
    switch (SCENES[sceneIndex].id) {
      case 'data':
        return <DateScene key="data" birthDate={birthDate} />;
      case 'foto':
        return <PhotoScene key="foto" avatarUrl={avatarUrl} fullName={fullName} />;
      case 'idade':
        return <AgeScene key="idade" age={age} avatarUrl={avatarUrl} fullName={fullName} paused={paused} />;
      case 'titulo':
        return <TitleScene key="titulo" firstName={firstName} avatarUrl={avatarUrl} fullName={fullName} />;
      case 'mensagem':
        return <MessageScene key="mensagem" firstName={firstName} />;
      default:
        return <OpeningScene key="abertura" todayLabel={todayLabel} late={late} />;
    }
  })();

  return (
    <div
      className="birthday-video fixed inset-0 z-[2147483000] overflow-hidden bg-[#07040f] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={`Vídeo de aniversário de ${fullName}`}
      onPointerDown={() => {
        // No iOS o AudioContext costuma nascer suspenso mesmo criado logo após
        // um clique; qualquer toque na tela serve de segunda chance.
        if (!pausedRef.current) musicRef.current?.resumeIfSuspended();
      }}
    >
      {/* Fundo vivo */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <motion.div
          className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full bg-orange-500/20 blur-[130px]"
          animate={{ x: [0, 60, -30, 0], y: [0, 40, -20, 0], scale: [1, 1.12, 0.96, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute -bottom-52 -right-32 h-[46rem] w-[46rem] rounded-full bg-fuchsia-700/20 blur-[150px]"
          animate={{ x: [0, -50, 30, 0], y: [0, -30, 25, 0], scale: [1, 1.08, 0.94, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute left-1/2 top-1/2 h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-[120px]"
          animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_36%,rgba(0,0,0,0.78)_100%)]" />
        <div className="birthday-grain absolute inset-0 opacity-[0.05]" />
      </div>

      <BokehCanvas className="pointer-events-none absolute inset-0 z-10 h-full w-full" />

      <AnimatePresence>{scene}</AnimatePresence>

      {/* Estouro do clímax: flash curto + ondas concêntricas saindo do centro. */}
      <AnimatePresence>
        {climax && !reduceMotion && (
          <motion.div
            key="climax-flash"
            className="pointer-events-none absolute inset-0 z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0 }}
            aria-hidden="true"
          >
            <motion.div
              className="absolute inset-0 bg-white"
              initial={{ opacity: 0.55 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.75, ease: 'easeOut' }}
            />
            {[0, 1, 2].map((index) => (
              <motion.div
                key={index}
                className="absolute left-1/2 top-1/2 h-[40vmin] w-[40vmin] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200/70"
                initial={{ scale: 0.1, opacity: 0.8 }}
                animate={{ scale: 5, opacity: 0 }}
                transition={{ duration: 1.6, delay: index * 0.22, ease: 'easeOut' }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <ConfettiCanvas ref={confettiRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full" />

      {/* Tarjas de cinema */}
      <motion.div
        className="birthday-letterbox pointer-events-none absolute inset-x-0 top-0 z-40 bg-black"
        initial={{ height: '50vh' }}
        animate={{ height: 'clamp(16px, 4.5vh, 56px)' }}
        transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
        aria-hidden="true"
      />
      <motion.div
        className="birthday-letterbox pointer-events-none absolute inset-x-0 bottom-0 z-40 bg-black"
        initial={{ height: '50vh' }}
        animate={{ height: 'clamp(16px, 4.5vh, 56px)' }}
        transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
        aria-hidden="true"
      />

      {/* Legendas */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[clamp(54px,10.5vh,110px)] z-40 grid grid-cols-1 justify-items-center px-6 [&>*]:col-start-1 [&>*]:row-start-1">
        <AnimatePresence>
          {subtitle && (
            <motion.p
              key={subtitle}
              role="status"
              className="max-w-3xl text-center text-[clamp(0.85rem,2.2vw,1.25rem)] font-medium leading-snug text-white [text-shadow:0_2px_14px_rgba(0,0,0,0.95),0_0_30px_rgba(0,0,0,0.7)]"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35 }}
            >
              {subtitle}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Controles do player */}
      <div className="absolute inset-x-0 bottom-0 z-50 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
        <div className="birthday-chrome mx-auto flex max-w-4xl items-center gap-3 rounded-full border border-white/10 px-4 py-2 backdrop-blur-md">
          <button
            type="button"
            onClick={togglePaused}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white"
            aria-label={paused ? 'Continuar' : 'Pausar'}
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>

          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              ref={progressRef}
              className="h-full rounded-full bg-gradient-to-r from-amber-200 via-orange-300 to-rose-300"
              style={{ width: '0%' }}
            />
          </div>

          <span
            ref={clockRef}
            className="font-birthday-kicker w-10 shrink-0 text-right text-xs font-medium tabular-nums text-white/55"
          >
            0:48
          </span>

          <button
            type="button"
            onClick={toggleMuted}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/85 transition hover:bg-white/15 hover:text-white"
            aria-label={muted ? 'Ativar som' : 'Desativar som'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          {!showFinal && (
            <button
              type="button"
              onClick={skipToEnd}
              className="font-birthday-kicker hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-white/60 transition hover:bg-white/15 hover:text-white sm:flex"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Pular
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="birthday-chrome absolute right-4 top-[clamp(34px,7vh,70px)] z-50 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/80 backdrop-blur transition hover:text-white sm:right-6"
        aria-label="Fechar"
      >
        <X className="h-5 w-5" />
      </button>

      <style>{`
        .birthday-video .birthday-shimmer {
          background: linear-gradient(100deg, #fef3c7 0%, #ffffff 24%, #fecdd3 48%, #ffffff 72%, #fef3c7 100%);
          background-size: 300% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          animation: birthdayShimmer 3.4s linear infinite;
        }
        @keyframes birthdayShimmer {
          0% { background-position: 0% 50%; }
          100% { background-position: 300% 50%; }
        }
        .birthday-video .birthday-grain {
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3'/></filter><rect width='140' height='140' filter='url(%23n)' opacity='0.5'/></svg>");
          animation: birthdayGrain 0.7s steps(3) infinite;
        }
        @keyframes birthdayGrain {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(-2%, 1%); }
          66% { transform: translate(1%, -2%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .birthday-video .birthday-grain,
          .birthday-video .birthday-shimmer { animation: none; }
        }
      `}</style>
    </div>
  );
}
