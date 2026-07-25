import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Replace, Search, X } from 'lucide-react';
import type { SyncfusionEditorRef } from '../SyncfusionEditor';

interface PetitionFindReplacePanelProps {
  editorRef: React.RefObject<SyncfusionEditorRef | null>;
  initialMode?: 'find' | 'replace';
  onClose: () => void;
  onDocumentChanged: () => void;
}

const PetitionFindReplacePanel: React.FC<PetitionFindReplacePanelProps> = ({
  editorRef,
  initialMode = 'find',
  onClose,
  onDocumentChanged,
}) => {
  const [mode, setMode] = useState<'find' | 'replace'>(initialMode);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState({ count: 0, current: 0 });
  const [feedback, setFeedback] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const runSearch = () => {
    const next = editorRef.current?.findText(query, { matchCase, wholeWord }) ?? { count: 0, current: 0 };
    setResult(next);
    setFeedback(query.trim() && next.count === 0 ? 'Nenhuma ocorrência encontrada.' : '');
  };

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(runSearch, 180);
    return () => window.clearTimeout(timer);
  }, [query, matchCase, wholeWord]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        editorRef.current?.clearSearch();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorRef, onClose]);

  const navigate = (direction: 'previous' | 'next') => {
    setResult(editorRef.current?.navigateSearch(direction) ?? { count: 0, current: 0 });
  };

  const replaceCurrent = () => {
    if (!query.trim() || result.count === 0) return;
    if (!editorRef.current?.replaceCurrentSearch(replacement)) return;
    onDocumentChanged();
    window.setTimeout(runSearch, 0);
    setFeedback('Ocorrência substituída.');
  };

  const replaceAll = () => {
    if (!query.trim() || result.count === 0) return;
    const count = result.count;
    if (!editorRef.current?.replaceAll(query, replacement, { matchCase, wholeWord })) return;
    onDocumentChanged();
    setResult({ count: 0, current: 0 });
    setFeedback(`${count} ocorrência${count === 1 ? '' : 's'} substituída${count === 1 ? '' : 's'}.`);
  };

  const closePanel = () => {
    editorRef.current?.clearSearch();
    onClose();
  };

  return (
    <aside className="petition-find-panel" aria-label="Localizar e substituir">
      <header className="petition-find-header">
        <div className="petition-find-tabs" role="tablist" aria-label="Modo de pesquisa">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'find'}
            className={mode === 'find' ? 'is-active' : ''}
            onClick={() => setMode('find')}
          >
            Localizar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'replace'}
            className={mode === 'replace' ? 'is-active' : ''}
            onClick={() => setMode('replace')}
          >
            Substituir
          </button>
        </div>
        <button type="button" className="petition-find-close" onClick={closePanel} aria-label="Fechar pesquisa">
          <X size={16} />
        </button>
      </header>

      <div className="petition-find-content">
        <label className="petition-find-field">
          <span>Localizar</span>
          <div>
            <Search size={15} />
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') navigate(event.shiftKey ? 'previous' : 'next');
              }}
              placeholder="Digite o texto"
            />
          </div>
        </label>

        {mode === 'replace' && (
          <label className="petition-find-field">
            <span>Substituir por</span>
            <div>
              <Replace size={15} />
              <input
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') replaceCurrent();
                }}
                placeholder="Novo texto"
              />
            </div>
          </label>
        )}

        <div className="petition-find-options">
          <label>
            <input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} />
            Diferenciar maiúsculas
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(event) => setWholeWord(event.target.checked)} />
            Somente palavras inteiras
          </label>
        </div>

        <div className="petition-find-summary" aria-live="polite">
          <span>{query.trim() ? `${result.count} resultado${result.count === 1 ? '' : 's'}` : 'Digite para pesquisar'}</span>
          {result.count > 0 && (
            <div>
              <button type="button" onClick={() => navigate('previous')} title="Ocorrência anterior">
                <ChevronUp size={16} />
              </button>
              <span>{result.current} de {result.count}</span>
              <button type="button" onClick={() => navigate('next')} title="Próxima ocorrência">
                <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>

        {mode === 'replace' && (
          <div className="petition-find-actions">
            <button type="button" onClick={replaceCurrent} disabled={!query.trim() || result.count === 0}>
              Substituir
            </button>
            <button type="button" className="is-primary" onClick={replaceAll} disabled={!query.trim() || result.count === 0}>
              Substituir tudo
            </button>
          </div>
        )}

        {feedback && <p className="petition-find-feedback" aria-live="polite">{feedback}</p>}
      </div>
    </aside>
  );
};

export default PetitionFindReplacePanel;
