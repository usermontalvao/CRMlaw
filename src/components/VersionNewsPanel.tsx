import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ExternalLink } from 'lucide-react';

import { FULL_APP_VERSION } from '../utils/appVersion';
import { LAYER } from '../styles/layers';
import {
  MAX_VERSIONS_SHOWN,
  compareVersions,
  countHiddenReleases,
  groupChangesByType,
  PREVIEW_VERSIONS,
  isProductionHost,
  parsePreviewRequest,
  pickUnseenReleases,
  seenStorageKey,
  type NewsRelease,
} from '../utils/versionNews';

/**
 * O AVISO DE "O QUE MUDOU" — o painel que entra pela direita depois de um deploy.
 *
 * Quem trabalha aqui nunca ficava sabendo o que tinha sido feito: o Changelog é
 * uma página que só vê quem vai atrás. Agora, quando a pessoa recarrega a
 * página e o pacote que chega é de uma versão que ela ainda não viu, o painel
 * abre uma vez contando o que veio de novo e o que foi corrigido.
 *
 * AS QUATRO REGRAS, todas testadas em `utils/versionNews.ts`:
 *
 * 1. O gatilho é RECARREGAR A PÁGINA, não o login. Quem fica com a aba aberta o
 *    dia inteiro só vê o aviso quando de fato recebe o pacote novo.
 * 2. UMA VEZ SÓ por versão. A marca de "já vi" é gravada no instante em que o
 *    painel aparece — fechar, ignorar ou trocar de tela dá no mesmo.
 * 3. SÓ EM PRODUÇÃO. Em `localhost` o pacote muda a cada salvamento.
 * 4. TODAS as versões desde a última vista, não só a mais nova: um push leva
 *    vários commits, e cada commit é uma versão.
 *
 * A lista de versões vem por `import()` sob demanda: são 22 mil linhas de
 * histórico, e elas só precisam existir no navegador de quem realmente vai ver
 * o aviso — o que acontece uma vez por deploy, por pessoa.
 */

interface VersionNewsPanelProps {
  /**
   * Quem vê o aviso. Hoje é o admin: foi o pedido original, e é quem sabe o que
   * fazer com "o que mudou". Para abrir a todos, basta o chamador passar `true`
   * para todo mundo — não há nada no painel que dependa de ser admin.
   */
  enabled: boolean;
  /** A marca de "já vi" é por pessoa: dois usuários no mesmo computador veem cada um o seu. */
  userId: string | null;
}

/**
 * As cores das pastilhas são escritas em HEXADECIMAL, e não como `bg-emerald-50`,
 * por um motivo concreto: `src/index.css` tem uma correção global de tema
 * escuro que casa por SUBSTRING — `.dark [class*="bg-"][class*="-50"]` pinta de
 * #171717, com `!important`, qualquer elemento que tenha uma classe com "bg-" e
 * outra terminada em 50, 100 ou 200. `bg-emerald-50` cai nela; `bg-[#ecfdf5]`
 * não. A mesma armadilha derruba `ring-orange-500` (o "-50" está dentro do
 * "500"), por isso o anel de foco aqui é `-400`.
 */
const TYPE_STYLE: Record<string, { label: string; className: string }> = {
  feature: { label: 'Novo', className: 'text-[#047857] bg-[#ecfdf5] dark:text-[#6ee7b7] dark:bg-[#022c22]' },
  improvement: { label: 'Melhoria', className: 'text-[#1d4ed8] bg-[#eff6ff] dark:text-[#93c5fd] dark:bg-[#0c1f3f]' },
  fix: { label: 'Correção', className: 'text-[#b45309] bg-[#fffbeb] dark:text-[#fcd34d] dark:bg-[#3a2606]' },
  security: { label: 'Segurança', className: 'text-[#b91c1c] bg-[#fef2f2] dark:text-[#fca5a5] dark:bg-[#3b0d0d]' },
  breaking: { label: 'Mudança de comportamento', className: 'text-[#7e22ce] bg-[#faf5ff] dark:text-[#d8b4fe] dark:bg-[#2a1039]' },
};

/**
 * O módulo aparece como etiqueta ao lado do título. Os ids vêm do histórico e
 * nem todos seguem o mesmo idioma (`documents` e `documentos` convivem lá).
 * O que não estiver no mapa vira o próprio id com a primeira letra maiúscula —
 * é melhor mostrar "Portal" do que esconder de onde a mudança veio.
 */
const MODULE_LABEL: Record<string, string> = {
  sistema: 'Sistema',
  core: 'Sistema',
  geral: 'Sistema',
  whatsapp: 'WhatsApp',
  chat: 'Mensagens',
  email: 'E-mail',
  assinaturas: 'Assinaturas',
  signature: 'Assinaturas',
  peticoes: 'Petições',
  petitions: 'Petições',
  documentos: 'Documentos',
  documents: 'Documentos',
  clientes: 'Clientes',
  processos: 'Processos',
  prazos: 'Prazos',
  agenda: 'Agenda',
  financeiro: 'Financeiro',
  intimacoes: 'Intimações',
  requerimentos: 'Requerimentos',
  leads: 'Leads',
  notificacoes: 'Notificações',
  configuracoes: 'Configurações',
  settings: 'Configurações',
  seguranca: 'Segurança',
  dashboard: 'Dashboard',
  portal: 'Portal do cliente',
  branding: 'Identidade visual',
  docs: 'Documentação',
};

function moduleLabel(moduleId: string): string {
  return MODULE_LABEL[moduleId] || (moduleId ? moduleId.charAt(0).toUpperCase() + moduleId.slice(1) : '');
}

function typeStyle(type: string) {
  return TYPE_STYLE[type] || { label: 'Alteração', className: 'text-[#3f3f46] bg-[#f4f4f5] dark:text-[#d4d4d8] dark:bg-[#27272a]' };
}

/**
 * O que o ensaio mostra: ou tudo desde a versão pedida, ou simplesmente as três
 * últimas versões escritas. Não passa pelo `pickUnseenReleases` porque ali a
 * versão do pacote é o teto — e em `localhost` o pacote é o de desenvolvimento.
 */
function previewReleases(all: readonly NewsRelease[], since: string | null): NewsRelease[] {
  const ordered = [...all].sort((a, b) => compareVersions(b.version, a.version));
  if (!since) return ordered.slice(0, PREVIEW_VERSIONS);
  return ordered.filter((release) => compareVersions(release.version, since) > 0).slice(0, MAX_VERSIONS_SHOWN);
}

const VersionNewsPanel: React.FC<VersionNewsPanelProps> = ({ enabled, userId }) => {
  const [releasesToShow, setReleasesToShow] = useState<NewsRelease[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const askedRef = useRef(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setEntered(false);
    // Espera a saída terminar antes de desmontar; sem movimento (quem pediu
    // menos animação no sistema), o desmonte é imediato.
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => setOpen(false), reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    if (!enabled || askedRef.current) return;
    if (typeof window === 'undefined') return;
    askedRef.current = true;

    // Ensaio: `?novidades=1` (ou `?novidades=1.10.330`) abre o painel na hora,
    // em qualquer ambiente, sem gravar marca nenhuma. É como se confere o
    // painel sem esperar o próximo deploy.
    const preview = parsePreviewRequest(window.location.search);

    if (!preview.active && !isProductionHost(window.location.hostname)) return;

    const key = seenStorageKey(userId);
    let lastSeen: string | null = null;
    try {
      lastSeen = window.localStorage.getItem(key);
    } catch {
      // Navegador sem armazenamento (janela anônima com cookies bloqueados):
      // sem onde gravar o "já vi", o aviso apareceria em TODA recarga. Melhor
      // não aparecer do que virar um pop-up perpétuo.
      return;
    }

    const markSeen = () => {
      // No ensaio nada é gravado: quem está conferindo o painel precisa poder
      // recarregar e vê-lo de novo.
      if (preview.active) return;
      try {
        window.localStorage.setItem(key, FULL_APP_VERSION);
      } catch {
        /* já tratado acima; aqui só não pode derrubar a tela */
      }
    };

    // Primeira vez nesta máquina: grava a versão atual e fica quieto. Ninguém
    // merece receber trezentas versões de uma vez por ter trocado de navegador.
    if (!preview.active && !lastSeen) {
      markSeen();
      return;
    }

    if (!preview.active && compareVersions(FULL_APP_VERSION, lastSeen!) <= 0) return;

    let cancelled = false;
    import('../data/releases')
      .then(({ releases }) => {
        if (cancelled) return;
        const unseen = preview.active
          ? previewReleases(releases, preview.since)
          : pickUnseenReleases(releases, lastSeen, FULL_APP_VERSION, MAX_VERSIONS_SHOWN);
        // A marca vai junto com a decisão, e não com o clique de fechar: o
        // combinado é aparecer uma vez, mesmo que a pessoa nem olhe.
        markSeen();
        if (unseen.length === 0) return;
        setReleasesToShow(unseen);
        setHiddenCount(
          preview.active ? 0 : countHiddenReleases(releases, lastSeen, FULL_APP_VERSION, MAX_VERSIONS_SHOWN),
        );
        setOpen(true);
      })
      .catch(() => {
        // Histórico não carregou (rede caiu no meio): o aviso simplesmente não
        // acontece. Não gravamos nada, então ele volta na próxima recarga.
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => setEntered(true));
    // O foco vai para o painel, não para o "✕": focar o botão desenhava um anel
    // laranja em volta dele — a primeira coisa que a pessoa via era o convite
    // para fechar. Assim o Esc funciona e a leitura começa pelo texto.
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const header = useMemo(() => {
    if (releasesToShow.length === 0) return { label: '', title: '' };
    if (releasesToShow.length === 1) {
      return {
        label: `VERSÃO ${releasesToShow[0].version} · ${releasesToShow[0].date}`,
        title: 'O que mudou nesta versão',
      };
    }
    const desde = releasesToShow[releasesToShow.length - 1].date;
    return {
      label: `${releasesToShow.length} VERSÕES · DESDE ${desde}`,
      title: 'O que mudou desde a sua última visita',
    };
  }, [releasesToShow]);

  if (!open || releasesToShow.length === 0) return null;

  return (
    <div className="fixed inset-0" style={{ zIndex: LAYER.NOTICE }} role="dialog" aria-modal="true" aria-label={header.title}>
      <button
        type="button"
        aria-label="Fechar o aviso de novidades"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default transition-opacity duration-200 motion-reduce:transition-none"
        style={{ background: 'rgba(20,20,22,0.12)', opacity: entered ? 1 : 0 }}
      />

      <aside
        ref={panelRef}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-[380px] flex-col overflow-hidden border-l focus:outline-none border-[#e7e5df] bg-white shadow-2xl transition-transform duration-200 ease-out motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-900"
        style={{ transform: entered ? 'translateX(0)' : 'translateX(100%)' }}
      >
        <header className="flex-none border-b border-[#e7e5df] px-5 pb-4 pt-5 dark:border-zinc-800">
          <div className="flex items-start gap-3">
            <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {header.label}
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Fechar"
              className="ml-auto -mr-1 -mt-1 rounded-lg p-1.5 text-zinc-400 transition hover:bg-[#f4f4f5] hover:text-zinc-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 dark:hover:bg-[#27272a] dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <h2 className="mt-1.5 text-[15px] font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            {header.title}
          </h2>
        </header>

        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [overflow-wrap:anywhere]">
          {releasesToShow.map((release) => (
            <section key={release.version} className="mb-5 last:mb-0">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="font-mono text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                  v{release.version}
                </span>
                <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">{release.date}</span>
                <span className="h-px flex-1 bg-[#e7e5df] dark:bg-zinc-800" />
              </div>

              {release.summary && (
                <p className="mb-3 text-[12.5px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                  {release.summary}
                </p>
              )}

              {groupChangesByType(release).map((group) => {
                const style = typeStyle(group.type);
                return (
                  <div key={group.type} className="mb-3.5 last:mb-0">
                    <div className={`mb-2 inline-flex rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${style.className}`}>
                      {style.label}
                    </div>
                    <ul className="flex flex-col gap-2.5">
                      {group.changes.map((change, index) => (
                        <li key={`${change.title}-${index}`}>
                          <p className="text-[12.5px] font-semibold leading-snug text-zinc-900 dark:text-zinc-100">
                            {change.title}
                            {change.moduleId && (
                              <span className="ml-1.5 inline-block rounded border border-[#e7e5df] px-1.5 py-px align-middle text-[10.5px] font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                                {moduleLabel(change.moduleId)}
                              </span>
                            )}
                          </p>
                          {change.description && (
                            // Cortada em duas linhas de propósito: as descrições
                            // do changelog têm parágrafos inteiros, e o painel
                            // vira um muro de texto que ninguém lê. O texto
                            // completo continua a um clique, no Changelog.
                            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                              {change.description}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}

          {hiddenCount > 0 && (
            <p className="pt-1 text-[11.5px] text-zinc-400 dark:text-zinc-500">
              {hiddenCount === 1
                ? 'Há mais 1 versão anterior no Changelog.'
                : `Há mais ${hiddenCount} versões anteriores no Changelog.`}
            </p>
          )}
        </div>

        <footer className="flex flex-none items-center gap-2 border-t border-[#e7e5df] px-5 py-3.5 dark:border-zinc-800">
          <a
            href="#/docs"
            onClick={close}
            // `bg-transparent` não é enfeite: no tema escuro o index.css pinta de
            // azul todo link SEM classe de fundo (`.dark a:not([class*="bg-"])`,
            // com !important). Declarar um fundo transparente tira este link da
            // regra e devolve a cor do texto ao componente.
            className="inline-flex items-center gap-1.5 rounded-lg bg-transparent px-2.5 py-2 text-[12.5px] font-semibold text-zinc-600 transition hover:text-orange-700 dark:text-zinc-300 dark:hover:text-orange-400"
          >
            Ver todas as versões
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={close}
            className="ml-auto rounded-lg bg-orange-600 px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-orange-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
          >
            Entendi
          </button>
        </footer>
      </aside>
    </div>
  );
};

export default VersionNewsPanel;
