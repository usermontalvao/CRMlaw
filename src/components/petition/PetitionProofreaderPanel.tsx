// Painel "Revisar texto" do Editor de Petições.
//
// Mostra, numa lista única, o que as quatro camadas encontraram (dicionário
// pt-BR, LanguageTool, regras jurídicas próprias e análise de contexto) e deixa
// o usuário aprovar correção por correção — nada é aplicado sozinho.
//
// A procedência de cada apontamento é detalhe interno: o cartão fala do ERRO e
// da regra, não de qual motor o encontrou.
//
// Cada cartão traz a REGRA gramatical aplicada: o objetivo é o advogado
// entender o erro (concordância de gênero, crase, regência), não só aceitar
// uma troca cega.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookPlus,
  Check,
  Crosshair,
  Info,
  Loader2,
  RefreshCw,
  ScanSearch,
  X,
} from 'lucide-react';
import type { SyncfusionEditorRef } from '../SyncfusionEditor';
import {
  applyIssueToState,
  buildReplacementWindow,
  proofreadDocument,
  proofCategoryLabel,
  refineSuggestionsWithContext,
  summarizeIssues,
  type ProofIssue,
  type ProofreadParagraph,
  type ProofreadResult,
  type ProofreadStage,
} from '../../services/petitionProofreader';
import { addWordToUserDictionary } from '../local-spell-checker';
import { aiService } from '../../services/ai.service';

interface PetitionProofreaderPanelProps {
  editorRef: React.RefObject<SyncfusionEditorRef | null>;
  onClose: () => void;
  onDocumentChanged: () => void;
}

const STAGE_LABEL: Record<ProofreadStage, string> = {
  spelling: 'Verificando ortografia…',
  rules: 'Aplicando regras jurídicas…',
  languagetool: 'Consultando o LanguageTool…',
  ai: 'Analisando o contexto…',
  done: 'Concluído',
};

const SEVERITY_COLOR: Record<ProofIssue['severity'], string> = {
  error: '#dc2626',
  warning: '#d97706',
  suggestion: '#2563eb',
};

const SOURCE_LABEL: Record<ProofIssue['source'], string> = {
  hunspell: 'Dicionário',
  languagetool: 'Gramática',
  'legal-rule': 'Regra jurídica',
  ai: 'Contexto',
};

const PetitionProofreaderPanel: React.FC<PetitionProofreaderPanelProps> = ({
  editorRef,
  onClose,
  onDocumentChanged,
}) => {
  const [issues, setIssues] = useState<ProofIssue[]>([]);
  const [paragraphs, setParagraphs] = useState<ProofreadParagraph[]>([]);
  const [skipped, setSkipped] = useState<ProofreadResult['skipped']>([]);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<ProofreadStage | null>(null);
  const [stageDetail, setStageDetail] = useState('');
  const [useAi, setUseAi] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('todas');
  const [feedback, setFeedback] = useState('');
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const aiEnabled = aiService.isEnabled();

  const runReview = useCallback(async (withAi: boolean) => {
    const editor = editorRef.current;
    if (!editor) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setFeedback('');
    setStage('spelling');

    try {
      const documentParagraphs = editor.getParagraphs();
      const result = await proofreadDocument(documentParagraphs, {
        useAi: withAi && aiEnabled,
        signal: controller.signal,
        onProgress: (nextStage, detail) => {
          setStage(nextStage);
          setStageDetail(detail || '');
        },
      });

      if (controller.signal.aborted) return;
      setIssues(result.issues);
      setParagraphs(result.paragraphs);
      setSkipped(result.skipped);
      if (!result.issues.length) setFeedback('Nenhum problema encontrado no documento.');
    } catch (err) {
      if (!controller.signal.aborted) {
        setFeedback(err instanceof Error ? err.message : 'Falha ao revisar o documento.');
      }
    } finally {
      if (!controller.signal.aborted) {
        setRunning(false);
        setStage(null);
        setStageDetail('');
      }
    }
  }, [aiEnabled, editorRef]);

  useEffect(() => {
    void runReview(false);
    return () => abortRef.current?.abort();
    // Revisão inicial sem IA: rápida e sem custo. A IA entra pelo toggle.
  }, [runReview]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const summary = useMemo(() => summarizeIssues(issues), [issues]);
  const visibleIssues = useMemo(
    () => (categoryFilter === 'todas' ? issues : issues.filter((i) => i.category === categoryFilter)),
    [issues, categoryFilter],
  );

  const locateIssue = (issue: ProofIssue) => {
    const found = editorRef.current?.selectOccurrence(issue.searchText, issue.occurrence);
    if (!found) setFeedback('Não localizei este trecho — o texto pode ter mudado. Revise novamente.');
  };

  const applySuggestion = (issue: ProofIssue, suggestion: string) => {
    const editor = editorRef.current;
    if (!editor) return;

    const replacement = buildReplacementWindow(issue, suggestion);
    const applied = editor.replaceOccurrence(issue.searchText, issue.occurrence, replacement);
    if (!applied) {
      setFeedback('Não consegui aplicar: o trecho mudou desde a última revisão. Clique em "Revisar novamente".');
      return;
    }

    const next = applyIssueToState({ issues, paragraphs, issue, suggestion });
    setIssues(next.issues);
    setParagraphs(next.paragraphs);
    setFeedback('');
    onDocumentChanged();
  };

  const ignoreIssue = (issue: ProofIssue) => {
    setIssues((current) => current.filter((i) => i.id !== issue.id));
  };

  const addToDictionary = async (issue: ProofIssue) => {
    await addWordToUserDictionary(issue.bad);
    // Some do painel toda ocorrência da mesma palavra, não só esta.
    setIssues((current) => current.filter((i) => !(i.source === 'hunspell' && i.bad === issue.bad)));
    setFeedback(`"${issue.bad}" foi adicionada ao seu dicionário.`);
  };

  const refineIssue = async (issue: ProofIssue) => {
    setRefiningId(issue.id);
    try {
      const suggestions = await refineSuggestionsWithContext(issue, paragraphs);
      setIssues((current) =>
        current.map((i) => (i.id === issue.id ? { ...i, suggestions, contextRefined: true } : i)),
      );
    } catch {
      setFeedback('Não foi possível sugerir uma correção pelo contexto para esta palavra.');
    } finally {
      setRefiningId(null);
    }
  };

  const toggleAi = (checked: boolean) => {
    setUseAi(checked);
    if (checked) void runReview(true);
  };

  const renderContext = (issue: ProofIssue) => {
    const before = issue.searchText.slice(0, issue.searchOffset);
    const after = issue.searchText.slice(issue.searchOffset + issue.length);
    return (
      <p className="petition-proof-context">
        {before && <span>…{before}</span>}
        <mark>{issue.bad}</mark>
        {after && <span>{after}…</span>}
      </p>
    );
  };

  return (
    <aside className="petition-proof-panel" aria-label="Revisão de texto">
      <header className="petition-proof-header">
        <div>
          <strong>Revisão de texto</strong>
          <span>{issues.length} apontamento{issues.length === 1 ? '' : 's'}</span>
        </div>
        <div className="petition-proof-header-actions">
          <button
            type="button"
            onClick={() => void runReview(useAi)}
            disabled={running}
            title="Revisar novamente"
          >
            <RefreshCw size={15} className={running ? 'petition-proof-spin' : undefined} />
          </button>
          <button type="button" onClick={onClose} title="Fechar revisão">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="petition-proof-toolbar">
        <label
          className="petition-proof-switch"
          title={aiEnabled
            ? 'Revisão aprofundada: regência, ambiguidade e concordância à distância'
            : 'Revisão aprofundada indisponível nesta instalação'}
        >
          <input
            type="checkbox"
            checked={useAi}
            disabled={!aiEnabled || running}
            onChange={(event) => toggleAi(event.target.checked)}
          />
          <ScanSearch size={13} />
          <span>Revisão aprofundada</span>
        </label>

        {summary.length > 0 && (
          <div className="petition-proof-filters">
            <button
              type="button"
              className={categoryFilter === 'todas' ? 'is-active' : ''}
              onClick={() => setCategoryFilter('todas')}
            >
              Todas ({issues.length})
            </button>
            {summary.map(({ category, count }) => (
              <button
                key={category}
                type="button"
                className={categoryFilter === category ? 'is-active' : ''}
                onClick={() => setCategoryFilter(category)}
              >
                {proofCategoryLabel(category)} ({count})
              </button>
            ))}
          </div>
        )}
      </div>

      {running && (
        <p className="petition-proof-status" aria-live="polite">
          <Loader2 size={14} className="petition-proof-spin" />
          {stage ? STAGE_LABEL[stage] : 'Revisando…'} {stageDetail}
        </p>
      )}

      {skipped.map((item) => (
        <p key={item.layer} className="petition-proof-warning">
          <AlertTriangle size={13} />
          <span>
            {item.layer === 'languagetool' ? 'Gramática' : item.layer === 'ai' ? 'Revisão aprofundada' : 'Dicionário'} não rodou: {item.reason}
          </span>
        </p>
      ))}

      {feedback && <p className="petition-proof-feedback">{feedback}</p>}

      <div className="petition-proof-list">
        {visibleIssues.map((issue) => (
          <article key={issue.id} className="petition-proof-card">
            <header>
              <span className="petition-proof-badge" style={{ background: SEVERITY_COLOR[issue.severity] }}>
                {proofCategoryLabel(issue.category)}
              </span>
              <span className="petition-proof-source">{SOURCE_LABEL[issue.source]}</span>
              <button
                type="button"
                className="petition-proof-locate"
                onClick={() => locateIssue(issue)}
                title="Localizar no documento"
              >
                <Crosshair size={13} />
              </button>
            </header>

            {renderContext(issue)}
            <p className="petition-proof-message">{issue.message}</p>

            {issue.explanation && (
              <>
                <button
                  type="button"
                  className="petition-proof-explain-toggle"
                  onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
                >
                  <Info size={12} />
                  {expandedId === issue.id ? 'Ocultar a regra' : 'Ver a regra gramatical'}
                </button>
                {expandedId === issue.id && <p className="petition-proof-explanation">{issue.explanation}</p>}
              </>
            )}

            <div className="petition-proof-suggestions">
              {issue.suggestions.length === 0 && <span className="petition-proof-empty">Sem sugestão automática</span>}
              {issue.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="petition-proof-apply"
                  onClick={() => applySuggestion(issue, suggestion)}
                  title="Aplicar esta correção no documento"
                >
                  <Check size={12} />
                  {suggestion}
                </button>
              ))}
            </div>

            <footer>
              {issue.source === 'hunspell' && aiEnabled && !issue.contextRefined && (
                <button type="button" onClick={() => void refineIssue(issue)} disabled={refiningId === issue.id}>
                  {refiningId === issue.id ? <Loader2 size={12} className="petition-proof-spin" /> : <ScanSearch size={12} />}
                  Sugerir pelo contexto
                </button>
              )}
              {issue.source === 'hunspell' && (
                <button type="button" onClick={() => void addToDictionary(issue)}>
                  <BookPlus size={12} />
                  Adicionar ao dicionário
                </button>
              )}
              <button type="button" onClick={() => ignoreIssue(issue)}>
                Ignorar
              </button>
            </footer>
          </article>
        ))}

        {!running && visibleIssues.length === 0 && !feedback && (
          <p className="petition-proof-empty-state">Nada a corrigir nesta categoria.</p>
        )}
      </div>
    </aside>
  );
};

export default PetitionProofreaderPanel;
