// Briefing da peça — o que o assistente pergunta ANTES de escrever a primeira
// linha num documento em branco.
//
// Sem isso, a única resposta possível é uma estrutura genérica ("DOS FATOS /
// DO DIREITO / DOS PEDIDOS"), que não serve para nada. Área, tipo de peça e
// polo mudam completamente os tópicos: inicial trabalhista tem "DA JORNADA";
// contestação tem "DAS PRELIMINARES"; recurso tem "DA TEMPESTIVIDADE".
//
// O formulário é LOCAL: preencher não consome nenhum token. O resultado vira
// contexto fixo de todas as mensagens seguintes da conversa.

import React, { useState } from 'react';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import type { PetitionChatBriefing } from '../../services/ai.service';

export const LEGAL_AREAS = [
  'Trabalhista',
  'Cível',
  'Previdenciário',
  'Família e Sucessões',
  'Consumidor',
  'Criminal',
  'Tributário',
  'Administrativo',
  'Empresarial',
  'Imobiliário',
];

export const DOCUMENT_TYPES = [
  'Petição inicial',
  'Contestação',
  'Réplica',
  'Recurso',
  'Manifestação',
  'Parecer',
  'Contrato',
  'Notificação extrajudicial',
];

export const PARTY_ROLES = [
  'Autor / Reclamante',
  'Réu / Reclamado',
  'Terceiro interessado',
];

export const BRIEFING_HIGHLIGHTS = [
  'Tutela de urgência',
  'Justiça gratuita',
  'Segredo de justiça',
  'Prioridade de tramitação',
  'Pedido de dano moral',
];

interface PetitionAiBriefingProps {
  value?: PetitionChatBriefing;
  /** Sugestões vindas do editor (área jurídica e tipo do documento aberto). */
  suggestedArea?: string;
  suggestedDocumentType?: string;
  onSubmit: (briefing: PetitionChatBriefing) => void;
  onCancel?: () => void;
  /** Rótulo do botão principal. */
  submitLabel?: string;
}

const chipClass = (active: boolean) => [
  'px-2.5 py-1 rounded-lg border text-[11.5px] font-medium transition text-left',
  active
    ? 'border-[var(--ai-accent)] bg-[var(--ai-accent)] text-white'
    : 'border-[var(--ai-border-strong)] bg-[var(--ai-surface)] text-[var(--ai-text)] hover:border-[var(--ai-accent)]',
].join(' ');

const PetitionAiBriefing: React.FC<PetitionAiBriefingProps> = ({
  value,
  suggestedArea,
  suggestedDocumentType,
  onSubmit,
  onCancel,
  submitLabel = 'Começar com este briefing',
}) => {
  const [area, setArea] = useState(value?.area || suggestedArea || '');
  const [documentType, setDocumentType] = useState(value?.documentType || suggestedDocumentType || '');
  const [party, setParty] = useState(value?.party || '');
  const [highlights, setHighlights] = useState<string[]>(value?.highlights || []);
  const [summary, setSummary] = useState(value?.summary || '');

  const toggleHighlight = (item: string) => {
    setHighlights((current) => (
      current.includes(item) ? current.filter((h) => h !== item) : [...current, item]
    ));
  };

  const canSubmit = Boolean(area && documentType);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      area,
      documentType,
      party: party || undefined,
      highlights: highlights.length ? highlights : undefined,
      summary: summary.trim() || undefined,
    });
  };

  const Section: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({ title, hint, children }) => (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ai-text-3)]">{title}</span>
        {hint && <span className="text-[9.5px] text-[var(--ai-text-3)]">{hint}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );

  return (
    <div className="rounded-xl border border-[var(--ai-accent-border)] bg-[var(--ai-surface)] p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ai-text)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--ai-accent)]" />
            Do que se trata esta peça?
          </div>
          <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ai-text-2)]">
            Com estes três itens eu monto a estrutura certa para o caso, não uma estrutura genérica.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded-lg p-1 text-[var(--ai-text-3)] transition hover:bg-[var(--ai-surface-2)] hover:text-[var(--ai-text)]"
            title="Fechar briefing"
            aria-label="Fechar briefing"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <Section title="Área do Direito" hint="obrigatório">
        {LEGAL_AREAS.map((item) => (
          <button key={item} type="button" onClick={() => setArea(area === item ? '' : item)} className={chipClass(area === item)}>
            {item}
          </button>
        ))}
      </Section>

      <Section title="Tipo de peça" hint="obrigatório">
        {DOCUMENT_TYPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setDocumentType(documentType === item ? '' : item)}
            className={chipClass(documentType === item)}
          >
            {item}
          </button>
        ))}
      </Section>

      <Section title="Nosso cliente é">
        {PARTY_ROLES.map((item) => (
          <button key={item} type="button" onClick={() => setParty(party === item ? '' : item)} className={chipClass(party === item)}>
            {item}
          </button>
        ))}
      </Section>

      <Section title="Pontos a contemplar" hint="opcional">
        {BRIEFING_HIGHLIGHTS.map((item) => (
          <button key={item} type="button" onClick={() => toggleHighlight(item)} className={chipClass(highlights.includes(item))}>
            {highlights.includes(item) && <Check className="mr-1 inline h-3 w-3" />}
            {item}
          </button>
        ))}
      </Section>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--ai-text-3)]">
          Resumo do caso <span className="font-medium normal-case tracking-normal text-[9.5px]">(opcional, mas melhora muito o resultado)</span>
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          placeholder="Ex.: cliente trabalhou de 03/2021 a 08/2025 como auxiliar, jornada 8h-19h sem intervalo, sem registro das horas extras, dispensado sem justa causa e sem pagamento das verbas."
          className="mt-1.5 w-full resize-none rounded-lg border border-[var(--ai-border)] bg-[var(--ai-surface-2)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--ai-text)] outline-none transition placeholder:text-[var(--ai-text-3)] focus:border-[var(--ai-accent)] focus:bg-[var(--ai-surface)]"
        />
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--ai-accent)] px-3 py-2 text-[12px] font-semibold text-white shadow-sm transition-all hover:bg-[var(--ai-accent-hover)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitLabel}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
      {!canSubmit && (
        <div className="text-center text-[10px] text-[var(--ai-text-3)]">
          Escolha a área e o tipo de peça para continuar.
        </div>
      )}
    </div>
  );
};

export default PetitionAiBriefing;
