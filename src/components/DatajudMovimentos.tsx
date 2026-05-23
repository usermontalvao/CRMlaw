// ─── DatajudMovimentos ────────────────────────────────────────────────────────
// Exibe movimentações processuais obtidas da API pública DataJud (CNJ).
// NÃO cria prazos automaticamente — apenas sugere ao usuário via painel inline.

import React, { useState, useCallback } from 'react';
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gavel,
  FileText,
  Mic,
  Bell,
  BookOpen,
  FolderX,
  CornerUpRight,
  Circle,
  Clock,
  Plus,
  X,
  Check,
} from 'lucide-react';
import {
  fetchDatajudMovimentos,
  getTribunalNome,
  categorizarMovimento,
  isSuggestaoPrazo,
  type DatajudMovimento,
  type DatajudResult,
  type MovimentoCategoria,
} from '../services/datajud.service';
import { deadlineService } from '../services/deadline.service';
import type { CreateDeadlineDTO } from '../types/deadline.types';

// ── Props ──────────────────────────────────────────────────────────────────────

interface DatajudMovimentosProps {
  /** Número do processo no formato CNJ */
  processNumber: string;
  /** ID do processo no banco — necessário para criar o prazo sugerido */
  processId?: string;
  /** ID do cliente — necessário para criar o prazo sugerido */
  clientId?: string;
  /** ID do usuário responsável para pré-preencher o prazo */
  userId?: string;
}

// ── Ícone por categoria ────────────────────────────────────────────────────────

function CategoriaIcon({ cat }: { cat: MovimentoCategoria }) {
  const cls = 'w-3.5 h-3.5 flex-shrink-0';
  switch (cat) {
    case 'sentenca':     return <Gavel        className={cls} />;
    case 'decisao':      return <Gavel        className={cls} />;
    case 'despacho':     return <FileText     className={cls} />;
    case 'audiencia':    return <Mic          className={cls} />;
    case 'citacao':      return <Bell         className={cls} />;
    case 'recurso':      return <CornerUpRight className={cls} />;
    case 'arquivamento': return <FolderX      className={cls} />;
    default:             return <Circle       className={`${cls} opacity-40`} />;
  }
}

function categoriaCor(cat: MovimentoCategoria): string {
  switch (cat) {
    case 'sentenca':     return 'text-purple-600 bg-purple-50';
    case 'decisao':      return 'text-amber-700 bg-amber-50';
    case 'despacho':     return 'text-slate-600 bg-slate-100';
    case 'audiencia':    return 'text-blue-600 bg-blue-50';
    case 'citacao':      return 'text-red-600 bg-red-50';
    case 'recurso':      return 'text-orange-600 bg-orange-50';
    case 'arquivamento': return 'text-slate-500 bg-slate-100';
    default:             return 'text-slate-400 bg-slate-50';
  }
}

function categoriaNome(cat: MovimentoCategoria): string {
  const map: Record<MovimentoCategoria, string> = {
    sentenca:     'Sentença',
    decisao:      'Decisão',
    despacho:     'Despacho',
    audiencia:    'Audiência',
    citacao:      'Citação/Intimação',
    recurso:      'Recurso',
    arquivamento: 'Arquivamento',
    outro:        'Movimentação',
  };
  return map[cat];
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function addDays(iso: string, days: number): string {
  const d = iso ? new Date(iso) : new Date();
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Painel de sugestão de prazo ────────────────────────────────────────────────

interface SugestaoProps {
  mov: DatajudMovimento;
  processId?: string;
  clientId?: string;
  userId?: string;
  onClose: () => void;
  onCreated: () => void;
}

function SugestaoPrazo({ mov, processId, clientId, userId, onClose, onCreated }: SugestaoProps) {
  const cat = categorizarMovimento(mov.codigo, mov.nome);
  const [title, setTitle]   = useState(`Prazo — ${mov.nome}`);
  const [date, setDate]     = useState(addDays(mov.dataHora, 15));
  const [desc, setDesc]     = useState(
    `Movimentação DataJud: ${mov.nome} em ${new Date(mov.dataHora).toLocaleDateString('pt-BR')}`
  );
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err, setErr]       = useState('');

  const canSave = !!(processId && clientId && title && date);

  async function handleCreate() {
    if (!canSave) return;
    setSaving(true);
    setErr('');
    try {
      const payload: CreateDeadlineDTO = {
        title,
        due_date:       date,
        process_id:     processId!,
        client_id:      clientId!,
        priority:       'alta',
        description:    desc || null,
        responsible_id: userId ?? null,
        type:           'processo',
        status:         'pendente',
      };
      await deadlineService.createDeadline(payload);
      setSaved(true);
      setTimeout(onCreated, 900);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erro ao criar prazo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-amber-100 border-b border-amber-200">
        <div className="flex items-center gap-2">
          <span className={`p-1 rounded ${categoriaCor(cat)}`}>
            <CategoriaIcon cat={cat} />
          </span>
          <span className="text-[11px] font-bold text-amber-800">Sugestão de prazo</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-amber-200 text-amber-600 transition">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-2">
        <div>
          <label className="block text-[10px] font-semibold text-amber-700 mb-1 uppercase tracking-wide">Título</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full text-xs rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-amber-700 mb-1 uppercase tracking-wide">Data do prazo (sugestão: +15 dias)</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full text-xs rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-amber-700 mb-1 uppercase tracking-wide">Observações</label>
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={2}
            className="w-full text-xs rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-400 resize-none"
          />
        </div>

        {!processId || !clientId ? (
          <p className="text-[10px] text-amber-700 italic">
            Não foi possível obter os IDs do processo/cliente para criar o prazo automaticamente. Crie-o manualmente no módulo de Prazos.
          </p>
        ) : null}

        {err && <p className="text-[10px] text-red-600">{err}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1 text-[11px] font-semibold text-slate-600 hover:text-slate-800 transition">
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            disabled={!canSave || saving || saved}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition disabled:opacity-50"
          >
            {saved
              ? <><Check className="w-3 h-3" /> Prazo criado!</>
              : saving
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Criando...</>
                : <><Plus className="w-3 h-3" /> Criar prazo</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Linha de movimentação ──────────────────────────────────────────────────────

interface MovItemProps {
  mov: DatajudMovimento;
  processId?: string;
  clientId?: string;
  userId?: string;
}

function MovItem({ mov, processId, clientId, userId }: MovItemProps) {
  const cat = categorizarMovimento(mov.codigo, mov.nome);
  const corCls = categoriaCor(cat);
  const sugere = isSuggestaoPrazo(cat);
  const [expanded,    setExpanded]    = useState(false);
  const [suggesting,  setSuggesting]  = useState(false);
  const hasComplementos = (mov.complementosTabelados?.length ?? 0) > 0;

  return (
    <>
      <div className="px-4 py-3 hover:bg-slate-50 transition-colors">
        <div className="flex items-start gap-3">
          {/* Ícone de categoria */}
          <div className={`mt-0.5 p-1.5 rounded-lg ${corCls} flex-shrink-0`}>
            <CategoriaIcon cat={cat} />
          </div>

          {/* Conteúdo */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-slate-800 leading-snug truncate">{mov.nome}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${corCls}`}>
                    {categoriaNome(cat)}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock className="w-2.5 h-2.5" />
                    {formatDateTime(mov.dataHora)}
                  </span>
                  {mov.orgaoJulgador && (
                    <span className="text-[10px] text-slate-400 truncate max-w-[160px]">
                      {mov.orgaoJulgador.nomeOrgao}
                    </span>
                  )}
                </div>
              </div>

              {/* Ações */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {sugere && !suggesting && (
                  <button
                    onClick={() => setSuggesting(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 transition whitespace-nowrap"
                    title="Sugerir criação de prazo baseada nesta movimentação"
                  >
                    <Plus className="w-3 h-3" />
                    Sugerir prazo
                  </button>
                )}
                {hasComplementos && (
                  <button
                    onClick={() => setExpanded(v => !v)}
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition"
                    title={expanded ? 'Recolher' : 'Ver detalhes'}
                  >
                    {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>

            {/* Complementos */}
            {expanded && hasComplementos && (
              <div className="mt-2 pl-1 space-y-1">
                {mov.complementosTabelados!.map((c, i) => (
                  <div key={i} className="text-[11px] text-slate-600 bg-slate-100 rounded-lg px-2.5 py-1.5">
                    <span className="font-semibold text-slate-700">{c.nome}:</span>{' '}
                    {c.descricao || c.valor}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Painel de sugestão inline */}
      {suggesting && (
        <SugestaoPrazo
          mov={mov}
          processId={processId}
          clientId={clientId}
          userId={userId}
          onClose={() => setSuggesting(false)}
          onCreated={() => setSuggesting(false)}
        />
      )}
    </>
  );
}

// ── Componente principal ───────────────────────────────────────────────────────

export function DatajudMovimentos({ processNumber, processId, clientId, userId }: DatajudMovimentosProps) {
  const [result,    setResult]    = useState<DatajudResult | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showAll,   setShowAll]   = useState(false);

  const PREVIEW = 5;

  const consultar = useCallback(async () => {
    setLoading(true);
    setResult(null);
    setShowAll(false);
    try {
      const r = await fetchDatajudMovimentos(processNumber);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }, [processNumber]);

  const movimentos    = result?.processo?.movimentos ?? [];
  const visible       = showAll ? movimentos : movimentos.slice(0, PREVIEW);
  const tribunalLabel = result?.tribunal ? getTribunalNome(result.tribunal) : null;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
        <button
          onClick={() => setCollapsed(v => !v)}
          className="flex items-center gap-2 text-left hover:opacity-70 transition"
        >
          <BookOpen className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Movimentações DataJud
          </span>
          {result?.processo && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums bg-slate-200 text-slate-500">
              {movimentos.length}
            </span>
          )}
          {collapsed
            ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            : <ChevronUp   className="w-3.5 h-3.5 text-slate-400" />}
        </button>

        <button
          onClick={consultar}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold rounded-lg bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 border border-slate-200 transition disabled:opacity-50"
        >
          {loading
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />}
          {loading ? 'Consultando...' : result ? 'Atualizar' : 'Consultar DataJud'}
        </button>
      </div>

      {/* Corpo */}
      {!collapsed && (
        <>
          {/* Estado inicial */}
          {!loading && !result && (
            <div className="px-4 py-6 text-center">
              <BookOpen className="w-7 h-7 text-slate-200 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                Clique em{' '}
                <button
                  onClick={consultar}
                  className="font-semibold text-slate-500 hover:text-amber-700 underline underline-offset-2 transition"
                >
                  Consultar DataJud
                </button>{' '}
                para buscar as movimentações no sistema público do CNJ.
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="px-4 py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              Consultando CNJ DataJud…
            </div>
          )}

          {/* Erro */}
          {!loading && result?.error && (
            <div className="px-4 py-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-slate-700 mb-0.5">Não foi possível consultar</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{result.error}</p>
              </div>
            </div>
          )}

          {/* Resultado */}
          {!loading && result?.processo && (
            <>
              {/* Metadados: tribunal + classe */}
              {tribunalLabel && (
                <div className="px-4 py-2 bg-gradient-to-r from-slate-800 to-slate-700 flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">{tribunalLabel}</span>
                  {result.processo.classe?.nome && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-[10px] text-slate-400 truncate">{result.processo.classe.nome}</span>
                    </>
                  )}
                  {result.processo.grau && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-[10px] text-slate-500">{result.processo.grau}</span>
                    </>
                  )}
                </div>
              )}

              {/* Lista */}
              {movimentos.length === 0 ? (
                <div className="px-4 py-5 text-center text-xs text-slate-400">
                  Nenhuma movimentação registrada no DataJud para este processo.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {visible.map((mov, i) => (
                    <MovItem
                      key={`${mov.codigo}-${i}`}
                      mov={mov}
                      processId={processId}
                      clientId={clientId}
                      userId={userId}
                    />
                  ))}
                </div>
              )}

              {/* Ver mais / menos */}
              {movimentos.length > PREVIEW && (
                <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50 text-center">
                  <button
                    onClick={() => setShowAll(v => !v)}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 transition"
                  >
                    {showAll
                      ? 'Mostrar menos'
                      : `Ver mais ${movimentos.length - PREVIEW} movimentações`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
