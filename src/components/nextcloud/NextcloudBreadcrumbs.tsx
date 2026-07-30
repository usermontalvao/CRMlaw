import React from 'react';
import { ArrowUp, ChevronLeft, ChevronRight, Home } from 'lucide-react';
import { NC_FOCUS_RING, NC_HOVER, NC_TEXT_FAINT, NC_TEXT_MUTED, NC_TEXT_STRONG } from './ncTokens';

/**
 * NextcloudBreadcrumbs — caminho atual e navegação de histórico.
 * -----------------------------------------------------------------------------
 * Voltar / avançar / subir um nível continuam ao lado do caminho porque são
 * gestos de explorador de arquivos: quem entra numa pasta errada procura a seta
 * antes de procurar o breadcrumb. O último segmento é o título da pasta e não
 * é clicável — clicar nele não levaria a lugar nenhum.
 */

interface NextcloudBreadcrumbsProps {
  segments: string[];
  onNavigate: (path: string) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onBack: () => void;
  onForward: () => void;
  onUp: () => void;
}

export const NextcloudBreadcrumbs: React.FC<NextcloudBreadcrumbsProps> = ({
  segments,
  onNavigate,
  canGoBack,
  canGoForward,
  canGoUp,
  onBack,
  onForward,
  onUp,
}) => {
  const navButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <nav aria-label="Caminho atual" className="flex min-w-0 items-center gap-0.5">
      <div className="mr-1 flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onBack}
          disabled={!canGoBack}
          title="Voltar (Alt+←)"
          aria-label="Voltar"
          className={`${navButton} ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onForward}
          disabled={!canGoForward}
          title="Avançar (Alt+→)"
          aria-label="Avançar"
          className={`${navButton} ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onUp}
          disabled={!canGoUp}
          title="Subir um nível (Alt+↑)"
          aria-label="Subir um nível"
          className={`${navButton} ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => onNavigate('')}
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm transition ${
            segments.length === 0 ? `font-medium ${NC_TEXT_STRONG}` : NC_TEXT_MUTED
          } ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <Home className="h-4 w-4" />
          <span className="hidden sm:inline">Início</span>
        </button>
        {segments.map((segment, index) => {
          const target = segments.slice(0, index + 1).join('/');
          const isLast = index === segments.length - 1;
          return (
            <React.Fragment key={target}>
              <ChevronRight className={`h-4 w-4 shrink-0 ${NC_TEXT_FAINT}`} />
              {isLast ? (
                <span className={`truncate px-2.5 text-sm font-medium ${NC_TEXT_STRONG}`} title={segment}>
                  {segment}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(target)}
                  className={`inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-sm transition ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
                >
                  {segment}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </nav>
  );
};

export default NextcloudBreadcrumbs;
