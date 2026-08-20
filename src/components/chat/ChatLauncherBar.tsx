// A barra flutuante de mensagens — a única peça do CRM que fica na tela em
// TODOS os módulos, sobre qualquer conteúdo.
//
// Está num arquivo próprio, e não dentro do widget, por dois motivos:
//
//   • ela é PURA. Recebe números e nomes, devolve pixels; não conhece Supabase,
//     rota nem permissão. Dá para abrir a bancada (`?chatlauncherpreview=1`, em
//     `src/dev/ChatLauncherPreview.tsx`) e ver os estados todos lado a lado,
//     inclusive os que quase nunca aparecem — 99+ pendências, nome sem foto,
//     Editor com alteração não salva;
//   • o widget tem mais de três mil linhas, e a peça mais vista do sistema
//     estava perdida no fim dele.
//
// ── DESENHO ──────────────────────────────────────────────────────────────────
//
// A versão anterior era uma pastilha azul-marinho (#111a2e) parada. Ela não
// pertencia a lugar nenhum: o painel que ela abre é BRANCO, a pill da pesquisa
// global é #f8f7f5 com fio #e7e5df, o laranja da casa é #f27a23 — e ali, no
// canto, um azul que não aparece em mais nenhum lugar do CRM, abaixo de um
// painel branco. Duas peças da mesma conversa, com duas caras.
//
// Agora a barra é feita do mesmo material do resto: superfície clara, fio de um
// pixel, sombra curta. Ela é a versão fechada do painel — quando abre, é o
// mesmo branco que cresce; quando fecha, é a ele que volta.
//
// ── MOVIMENTO ────────────────────────────────────────────────────────────────
//
// Nada aqui pisca sozinho. Todo movimento é resposta a um fato:
//
//   · a barra ENTRA uma vez, subindo, quando a página carrega;
//   · a LARGURA é animada (`layout`): quando o rosto de quem escreveu entra, ou
//     o Editor se minimiza, a barra cresce em vez de dar um tranco;
//   · o NÚMERO troca deslizando, e dá UM pulso quando SOBE — chegou coisa nova.
//     Quando desce (você leu), ele só encolhe: ler não merece alarme;
//   · ABRIR vira estado visível — o ícone gira para uma seta para baixo, o
//     rótulo passa a "Fechar", a superfície ganha o tom quente do laranja. Sem
//     isso, o botão continuava dizendo "Mensagens" com as mensagens já abertas.
//
// Nenhum laço infinito: o que pulsa o dia inteiro vira paisagem e para de
// avisar. E quem pediu "reduzir movimento" ao sistema recebe tudo isso sem um
// pixel de animação — o estado continua escrito no `title` e no `aria-label`.
//
// ARMADILHA. O botão NÃO pode ter a classe `border`, e nenhum ancestral pode ser
// `fixed z-50`: `index.css` tem um bloco antigo de "correção global de modais"
// que pinta `div[class*="fixed"][class*="z-50"]` de preto 60% e qualquer
// `button[class*="border"]` dentro dele de #3a3a3c — com `!important`. A borda
// daqui vem por `style`, de propósito.
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, FileText, MessageCircle } from 'lucide-react';

/** Laranja da casa — o mesmo dos badges da barra lateral (`App.tsx`). */
const BRAND = '#f27a23';

/** Acima disso o número vira "99+": quatro dígitos deformariam a barra. */
const BADGE_MAX = 99;

// Duas sombras: uma curta, que cola a peça na superfície, e uma difusa e larga,
// que a separa do conteúdo por baixo — é ela que faz o branco sobre branco
// (um módulo de fundo claro) continuar sendo uma peça, e não um recorte. No
// hover a difusa cresce: a barra sobe 2px e a sombra acompanha, senão o
// movimento parece um solavanco.
const SOMBRA = '0 1px 2px rgba(32,33,36,.12), 0 6px 16px -6px rgba(15,23,42,.22), 0 18px 34px -20px rgba(15,23,42,.45)';
const SOMBRA_HOVER = '0 1px 2px rgba(32,33,36,.14), 0 10px 22px -8px rgba(15,23,42,.26), 0 26px 44px -22px rgba(15,23,42,.5)';

export interface ChatLauncherBarProps {
  /** Total de pendências — equipe + WhatsApp somados. */
  badgeCount: number;
  /** Dica do mouse: é ela que abre a conta de onde vem o número. */
  title: string;
  /** Rosto de quem escreveu por último, quando há pendência. */
  peerName?: string | null;
  peerAvatarUrl?: string | null;
  /** O painel está aberto? A barra é o botão de fechar dele. */
  open?: boolean;
  /** O Editor de Petições está minimizado nesta aba? Então ele mora aqui. */
  editorMinimized?: boolean;
  editorHasUnsavedChanges?: boolean;
  onToggle: () => void;
  onOpenEditor: () => void;
}

const contador = (n: number) => (n > BADGE_MAX ? `${BADGE_MAX}+` : String(n));

const ChatLauncherBar: React.FC<ChatLauncherBarProps> = ({
  badgeCount,
  title,
  peerName,
  peerAvatarUrl,
  open = false,
  editorMinimized = false,
  editorHasUnsavedChanges = false,
  onToggle,
  onOpenEditor,
}) => {
  const semMovimento = useReducedMotion();
  const temPendencia = badgeCount > 0;
  // Com o painel aberto o rosto some: quem escreveu já está na lista, a um
  // palmo dali, com o nome inteiro.
  const mostraRosto = temPendencia && !open && !!(peerName || peerAvatarUrl);

  /** Uma mola só, usada em tudo — é o que dá liga entre as partes. */
  const mola = semMovimento
    ? { duration: 0 }
    : ({ type: 'spring', stiffness: 460, damping: 34, mass: 0.7 } as const);

  // Pulso do contador: só na SUBIDA, e uma vez.
  const [pulsar, setPulsar] = useState(false);
  const anterior = useRef(badgeCount);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = badgeCount;
    if (semMovimento || badgeCount <= antes) return;
    setPulsar(true);
    const id = window.setTimeout(() => setPulsar(false), 900);
    return () => window.clearTimeout(id);
  }, [badgeCount, semMovimento]);

  // Três superfícies, a mesma família: repouso, com pendência (um fio de calor
  // no branco) e aberta (o laranja assumido, porque agora ela é o "fechar").
  const superficie: React.CSSProperties = open
    ? { background: 'linear-gradient(180deg,#fff8f2 0%,#ffeedd 100%)', borderColor: 'rgba(242,122,35,.38)' }
    : temPendencia
      ? { background: 'linear-gradient(180deg,#ffffff 0%,#fff9f4 100%)', borderColor: '#f0dcc5' }
      : { background: 'linear-gradient(180deg,#ffffff 0%,#f8f7f5 100%)', borderColor: '#e7e5df' };

  const corIcone = open || temPendencia ? BRAND : '#64748b';

  const badge = (extra?: React.CSSProperties) => (
    <motion.span
      layout
      initial={semMovimento ? false : { scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={semMovimento ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
      transition={mola}
      className="relative inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-semibold leading-none tabular-nums overflow-hidden"
      style={{ background: BRAND, boxShadow: '0 1px 3px rgba(242,122,35,.45)', ...extra }}
    >
      {/* O pulso é um anel que sai do badge e morre. Não repete. */}
      {pulsar && (
        <motion.span
          key={badgeCount}
          className="absolute inset-0 rounded-full pointer-events-none"
          initial={{ boxShadow: `0 0 0 0 rgba(242,122,35,.55)` }}
          animate={{ boxShadow: `0 0 0 12px rgba(242,122,35,0)` }}
          transition={{ duration: 0.75, ease: 'easeOut' }}
          aria-hidden
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={contador(badgeCount)}
          initial={semMovimento ? false : { y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={semMovimento ? { opacity: 0 } : { y: 12, opacity: 0 }}
          transition={mola}
          className="block"
        >
          {contador(badgeCount)}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );

  const icone = (tamanho: number) => (
    <span className="relative block" style={{ width: tamanho, height: tamanho }}>
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.span
            key="fechar"
            className="absolute inset-0"
            initial={semMovimento ? false : { rotate: -90, opacity: 0, scale: 0.7 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={semMovimento ? { opacity: 0 } : { rotate: 90, opacity: 0, scale: 0.7 }}
            transition={mola}
          >
            <ChevronDown style={{ width: tamanho, height: tamanho, color: corIcone }} strokeWidth={2.1} />
          </motion.span>
        ) : (
          <motion.span
            key="mensagens"
            className="absolute inset-0"
            initial={semMovimento ? false : { rotate: 90, opacity: 0, scale: 0.7 }}
            animate={{ rotate: 0, opacity: 1, scale: 1 }}
            exit={semMovimento ? { opacity: 0 } : { rotate: -90, opacity: 0, scale: 0.7 }}
            transition={mola}
          >
            <MessageCircle style={{ width: tamanho, height: tamanho, color: corIcone }} strokeWidth={2} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );

  return (
    <motion.button
      layout
      data-chat-floating-widget-launcher="1"
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-expanded={open}
      initial={semMovimento ? false : { opacity: 0, y: 14, scale: 0.94, boxShadow: SOMBRA }}
      animate={{ opacity: 1, y: 0, scale: 1, boxShadow: SOMBRA }}
      whileHover={semMovimento ? undefined : { y: -2, boxShadow: SOMBRA_HOVER }}
      whileTap={semMovimento ? undefined : { scale: 0.97 }}
      transition={mola}
      className="group relative overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      style={{
        borderRadius: 999,
        borderWidth: 1,
        borderStyle: 'solid',
        ...superficie,
        boxShadow: SOMBRA,
      }}
    >
      {/* Celular — só o círculo; não há espaço para rótulo nem para o Editor. */}
      <motion.div layout className="sm:hidden flex items-center justify-center h-[52px] w-[52px] relative">
        {icone(21)}
        <AnimatePresence>
          {temPendencia && (
            <span className="absolute" style={{ top: 6, right: 5 }}>
              {badge({ boxShadow: '0 0 0 2px #ffffff' })}
            </span>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Computador — barra horizontal, até três blocos. */}
      <motion.div layout className="hidden sm:flex items-stretch relative">
        <motion.div layout className="flex items-center gap-2.5 pl-4 pr-4 h-11">
          {icone(17)}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={open ? 'Fechar' : 'Mensagens'}
              layout
              initial={semMovimento ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={semMovimento ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={mola}
              className="text-[13px] font-semibold tracking-[-0.005em] whitespace-nowrap"
              style={{ color: open ? '#9a4a10' : '#334155' }}
            >
              {open ? 'Fechar' : 'Mensagens'}
            </motion.span>
          </AnimatePresence>
          <AnimatePresence mode="popLayout">{temPendencia && badge()}</AnimatePresence>
        </motion.div>

        <AnimatePresence mode="popLayout">
          {editorMinimized && (
            <motion.div
              key="editor"
              layout
              initial={semMovimento ? false : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={semMovimento ? { opacity: 0 } : { opacity: 0, width: 0 }}
              transition={mola}
              className="flex items-stretch overflow-hidden"
            >
              <div className="my-2.5 w-px shrink-0" style={{ background: 'rgba(15,23,42,.10)' }} aria-hidden />
              {/* Não é <button>: já estamos dentro de um, e botão dentro de botão
                  é HTML inválido — o navegador desmonta a árvore. */}
              <div
                role="button"
                tabIndex={0}
                className="flex items-center gap-2 px-3.5 h-11 whitespace-nowrap text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.04] transition-colors"
                title={editorHasUnsavedChanges ? 'Abrir Editor — há alterações não salvas' : 'Abrir Editor'}
                onClick={(e) => { e.stopPropagation(); onOpenEditor(); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    onOpenEditor();
                  }
                }}
              >
                <FileText className="w-[15px] h-[15px]" strokeWidth={1.9} />
                <span className="text-[13px] font-medium">Editor</span>
                {editorHasUnsavedChanges && (
                  // Ponto sólido, sem pulsar: "não salvo" é um estado, não um
                  // alarme. Quem passa o mouse lê a frase inteira.
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="popLayout">
          {mostraRosto && (
            <motion.div
              key="rosto"
              layout
              initial={semMovimento ? false : { opacity: 0, width: 0, scale: 0.6 }}
              animate={{ opacity: 1, width: 'auto', scale: 1 }}
              exit={semMovimento ? { opacity: 0 } : { opacity: 0, width: 0, scale: 0.6 }}
              transition={mola}
              className="flex items-center pr-1.5 h-11 overflow-hidden"
            >
              {peerAvatarUrl ? (
                <img
                  src={peerAvatarUrl}
                  alt={peerName || ''}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                  style={{ boxShadow: '0 0 0 1px rgba(15,23,42,.10)' }}
                />
              ) : (
                <div
                  className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg,#fdba74,#f27a23)' }}
                >
                  {(peerName || '?').substring(0, 1).toUpperCase()}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.button>
  );
};

export default ChatLauncherBar;
