/**
 * Console do Atendente de IA — janela cheia, aberta pelo ícone de IA no módulo
 * de WhatsApp (só administrador).
 *
 * Três seções e uma nav própria, porque isto não é uma configuração solta: é um
 * lugar onde se administra agentes, canais e se lê o que a IA andou decidindo.
 * Antes estava enfiado num acordeão de Configurações — lugar errado, e ninguém
 * achava.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot, X, Users, Radio, ScrollText, Search, Loader2, RefreshCw, ChevronLeft,
  CheckCircle2, XCircle, EyeOff, Circle, AlertTriangle,
} from 'lucide-react';
import {
  agentsApi, type WaAgent, type WaAgentMode, type WaChannelAgentInfo,
  type WaRunEnriched, type WaRunVerdict,
} from '../../../services/whatsapp/agents';
import { WA_AGENT_TOOLS_DISPLAY } from '../../../shared/waAgentTools';
import PromptEditor, { problemasDoPrompt } from './PromptEditor';

type Secao = 'agentes' | 'canais' | 'decisoes';

const CARD = 'bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]';

const MODOS: Array<{ v: WaAgentMode; label: string; hint: string }> = [
  { v: 'sombra', label: 'Sombra', hint: 'Decide e registra. Não envia nada ao cliente, não altera nada no CRM.' },
  { v: 'aprovacao', label: 'Aprovação', hint: 'Escreve a resposta e espera alguém aprovar antes de enviar.' },
  { v: 'automatico', label: 'Automático', hint: 'Responde e executa sozinho. Gatilho de risco alto continua pedindo aprovação.' },
];

const PAPEIS: Record<string, string> = {
  triagem: 'Triagem', qualificacao: 'Qualificação', documentos: 'Documentos',
  proposta: 'Proposta', fechamento: 'Fechamento', atendimento: 'Atendimento',
};

const VERDITO: Record<WaRunVerdict, { rotulo: string; classe: string }> = {
  simulado:  { rotulo: 'teria feito', classe: 'bg-slate-100 text-slate-600' },
  executado: { rotulo: 'executado',   classe: 'bg-emerald-50 text-emerald-700' },
  barrado:   { rotulo: 'barrado',     classe: 'bg-red-50 text-red-700' },
  aprovacao: { rotulo: 'aguarda ok',  classe: 'bg-amber-50 text-amber-700' },
};

const RISCO: Record<string, string> = {
  baixo: 'bg-emerald-50 text-emerald-700',
  medio: 'bg-amber-50 text-amber-700',
  alto: 'bg-red-50 text-red-700',
};

const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

// ── Console ─────────────────────────────────────────────────────────────────

export const AgentConsole: React.FC<{
  onClose: () => void;
  currentUserId?: string | null;
}> = ({ onClose, currentUserId }) => {
  const [secao, setSecao] = useState<Secao>('agentes');
  const [agentes, setAgentes] = useState<WaAgent[]>([]);
  const [canais, setCanais] = useState<WaChannelAgentInfo[]>([]);
  const [runs, setRuns] = useState<WaRunEnriched[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [a, c, r] = await Promise.all([agentsApi.list(), agentsApi.channels(), agentsApi.runs(80)]);
      setAgentes(a); setCanais(c); setRuns(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const nav: Array<{ k: Secao; label: string; Icon: typeof Users; contagem?: number }> = [
    { k: 'agentes', label: 'Agentes', Icon: Users, contagem: agentes.length },
    { k: 'canais', label: 'Canais', Icon: Radio, contagem: canais.length },
    { k: 'decisoes', label: 'Decisões', Icon: ScrollText, contagem: runs.length },
  ];

  return (
    <div className="fixed inset-0 z-[9000] bg-[#f5f5f3] flex flex-col">
      <header className="flex items-center gap-3 px-4 h-14 bg-white border-b border-[#e7e5df] shrink-0">
        <Bot className="w-5 h-5 text-amber-600 shrink-0" />
        <div className="min-w-0">
          <h1 className="text-[14.5px] font-semibold text-slate-800 leading-tight">Atendente de IA</h1>
          <p className="text-[11.5px] text-slate-500 leading-tight">WhatsApp · administração</p>
        </div>
        <div className="flex-1" />
        <button
          type="button" onClick={() => void carregar()} disabled={carregando}
          className="p-2 rounded-lg hover:bg-[#f5f5f3] text-slate-500 disabled:opacity-40"
          title="Atualizar"
        >
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
        <button
          type="button" onClick={onClose}
          className="p-2 rounded-lg hover:bg-[#f5f5f3] text-slate-500"
          title="Fechar (Esc)"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </header>

      <div className="flex-1 flex min-h-0">
        <nav className="w-[188px] shrink-0 bg-white border-r border-[#e7e5df] p-2.5 hidden sm:block">
          {nav.map(({ k, label, Icon, contagem }) => (
            <button
              key={k} type="button" onClick={() => setSecao(k)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl mb-0.5 transition text-left ${
                secao === k ? 'bg-amber-50 text-amber-800' : 'text-slate-600 hover:bg-[#faf9f7]'}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-[13px] font-medium flex-1">{label}</span>
              {contagem !== undefined && (
                <span className="text-[11px] tabular-nums text-slate-400">{contagem}</span>
              )}
            </button>
          ))}
        </nav>

        <main className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-5">
          <div className="sm:hidden flex gap-1 p-1 rounded-xl bg-white border border-[#e7e5df] w-fit mb-4">
            {nav.map(({ k, label }) => (
              <button
                key={k} type="button" onClick={() => setSecao(k)}
                className={`px-3 py-1.5 rounded-lg text-[12.5px] font-medium ${
                  secao === k ? 'bg-[#f5f5f3] text-slate-800' : 'text-slate-500'}`}
              >{label}</button>
            ))}
          </div>

          {erro && (
            <div className={`${CARD} p-3.5 mb-4 flex items-start gap-2.5 text-[13px] text-red-700`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {secao === 'agentes' && (
            <SecaoAgentes agentes={agentes} currentUserId={currentUserId} onSalvo={carregar} />
          )}
          {secao === 'canais' && <SecaoCanais canais={canais} onMudou={carregar} />}
          {secao === 'decisoes' && <SecaoDecisoes runs={runs} carregando={carregando} />}
        </main>
      </div>
    </div>
  );
};

// ── Agentes ─────────────────────────────────────────────────────────────────

const SecaoAgentes: React.FC<{
  agentes: WaAgent[];
  currentUserId?: string | null;
  onSalvo: () => Promise<void> | void;
}> = ({ agentes, currentUserId, onSalvo }) => {
  const [busca, setBusca] = useState('');
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return agentes;
    return agentes.filter(a =>
      a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q));
  }, [agentes, busca]);

  const aberto = agentes.find(a => a.id === abertoId) ?? null;

  if (aberto) {
    return (
      <div className="space-y-4">
        <button
          type="button" onClick={() => setAbertoId(null)}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="w-4 h-4" /> Todos os agentes
        </button>
        <EditorAgente
          key={aberto.id} agente={aberto} currentUserId={currentUserId} onSalvo={onSalvo}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Pesquisar agentes…"
          className="w-full pl-9 pr-3 py-2 text-[13px] rounded-xl border border-[#e7e5df] bg-white focus:outline-none focus:ring-2 focus:ring-amber-100"
        />
      </div>

      {filtrados.length === 0 ? (
        <div className={`${CARD} p-12 text-center`}>
          <Bot className="w-6 h-6 text-slate-300 mx-auto mb-2.5" />
          <p className="text-[13.5px] text-slate-600 font-medium">
            {busca ? 'Nenhum agente com esse nome' : 'Nenhum agente cadastrado'}
          </p>
        </div>
      ) : (
        <div className={`${CARD} divide-y divide-[#e7e5df] overflow-hidden`}>
          {filtrados.map(a => (
            <button
              key={a.id} type="button" onClick={() => setAbertoId(a.id)}
              className="w-full flex items-center gap-3 p-3.5 text-left hover:bg-[#faf9f7] transition"
            >
              <span className="w-9 h-9 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                <Bot className="w-4.5 h-4.5 text-amber-700" />
              </span>

              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13.5px] font-semibold text-slate-800">{a.name}</span>
                  {a.is_primary && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                      primário
                    </span>
                  )}
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">
                    {a.mode}
                  </span>
                </span>
                <span className="block text-[12.5px] text-slate-500 truncate mt-0.5">
                  {a.description || PAPEIS[a.role] || a.role}
                </span>
              </span>

              <span className="flex items-center gap-1.5 shrink-0">
                <Circle
                  className={`w-2 h-2 ${a.is_active ? 'fill-emerald-500 text-emerald-500' : 'fill-slate-300 text-slate-300'}`}
                />
                <span className="text-[11.5px] text-slate-400 hidden sm:inline">
                  {a.is_active ? 'ativo' : 'desligado'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const EditorAgente: React.FC<{
  agente: WaAgent;
  currentUserId?: string | null;
  onSalvo: () => Promise<void> | void;
}> = ({ agente, currentUserId, onSalvo }) => {
  const [prompt, setPrompt] = useState(agente.prompt);
  const [modo, setModo] = useState<WaAgentMode>(agente.mode);
  const [ativo, setAtivo] = useState(agente.is_active);
  const [tools, setTools] = useState<string[]>(agente.allowed_tools || []);
  const [debounce, setDebounce] = useState(agente.debounce_seconds);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const mudou =
    prompt !== agente.prompt || modo !== agente.mode || ativo !== agente.is_active ||
    debounce !== agente.debounce_seconds ||
    tools.join(',') !== (agente.allowed_tools || []).join(',');

  // Menção inexistente trava o salvamento: a IA ignoraria a instrução em
  // silêncio e ninguém entenderia por que ela não fez o passo.
  const quebradas = problemasDoPrompt(prompt, tools).filter(p => p.nivel === 'inexistente');

  const salvar = async () => {
    setSalvando(true); setAviso(null);
    try {
      await agentsApi.savePrompt(agente, prompt, currentUserId ?? null);
      await agentsApi.save(agente.id, {
        mode: modo, is_active: ativo, allowed_tools: tools, debounce_seconds: debounce,
      });
      await onSalvo();
      setAviso('Salvo.');
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'Não consegui salvar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-4 items-start">
      <div className={`${CARD} p-4`}>
        <PromptEditor value={prompt} onChange={setPrompt} liberados={tools} />
      </div>

      <div className="space-y-4">
        <div className={`${CARD} p-4 space-y-3.5`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-slate-800 truncate">{agente.name}</h3>
              <p className="text-[12px] text-slate-500">{PAPEIS[agente.role] || agente.role}</p>
            </div>
            <span className="text-[11px] text-slate-400 font-mono shrink-0">v{agente.version}</span>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1.5">Modo</label>
            <div className="flex gap-1 p-1 rounded-xl bg-[#f5f5f3]">
              {MODOS.map(m => (
                <button
                  key={m.v} type="button" onClick={() => setModo(m.v)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[12px] font-medium transition ${
                    modo === m.v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >{m.label}</button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-slate-500 leading-snug">
              {MODOS.find(m => m.v === modo)?.hint}
            </p>
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1.5">
              Agrupar mensagens
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number" min={0} max={120} value={debounce}
                onChange={e => setDebounce(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
                className="w-20 px-2.5 py-1.5 text-[13px] rounded-lg border border-[#e7e5df] focus:outline-none focus:ring-2 focus:ring-amber-100"
              />
              <span className="text-[12px] text-slate-500">segundos</span>
            </div>
            <p className="mt-1.5 text-[11.5px] text-slate-500 leading-snug">
              Espera o cliente terminar de digitar antes de responder.
            </p>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer pt-1">
            <input
              type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-amber-600"
            />
            <span>
              <span className="block text-[13px] font-medium text-slate-800">Agente ativo</span>
              <span className="block text-[11.5px] text-slate-500 leading-snug">
                Desligado, não atende nem registra.
              </span>
            </span>
          </label>
        </div>

        <div className={`${CARD} p-4`}>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">
            Gatilhos liberados
          </label>
          <p className="text-[11.5px] text-slate-500 mb-2.5 leading-snug">
            O que não estiver marcado não é oferecido à IA — ela nem sabe que existe.
          </p>
          <div className="space-y-1">
            {WA_AGENT_TOOLS_DISPLAY.map(t => (
              <label
                key={t.name}
                title={t.implemented ? t.description : 'O motor ainda não executa este gatilho'}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${
                  t.implemented ? 'cursor-pointer hover:bg-[#faf9f7]' : 'opacity-45 cursor-not-allowed'}`}
              >
                <input
                  type="checkbox" disabled={!t.implemented}
                  checked={tools.includes(t.name)}
                  onChange={() => setTools(x => x.includes(t.name) ? x.filter(y => y !== t.name) : [...x, t.name])}
                  className="w-4 h-4 accent-amber-600 shrink-0"
                />
                <span className="flex-1 min-w-0 text-[12px] font-mono text-slate-700 truncate">{t.name}</span>
                <span className={`text-[9.5px] uppercase px-1.5 py-0.5 rounded shrink-0 ${RISCO[t.risk]}`}>
                  {t.risk}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2.5 text-[11.5px] text-slate-500 leading-snug">
            Risco <strong>alto</strong> sempre pede aprovação humana, mesmo em modo automático.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button" onClick={() => void salvar()}
            disabled={!mudou || salvando || quebradas.length > 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-600 text-white text-[13px] font-medium hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Salvar
          </button>
          {quebradas.length > 0 && (
            <span className="text-[12px] text-red-700 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" />
              {quebradas.length === 1 ? `@${quebradas[0].texto} não existe` : `${quebradas.length} menções não existem`}
            </span>
          )}
          {aviso && (
            <span className={`text-[12px] ${aviso === 'Salvo.' ? 'text-emerald-700' : 'text-red-700'}`}>{aviso}</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Canais ──────────────────────────────────────────────────────────────────

const SecaoCanais: React.FC<{
  canais: WaChannelAgentInfo[];
  onMudou: () => Promise<void> | void;
}> = ({ canais, onMudou }) => {
  const [mexendo, setMexendo] = useState<string | null>(null);

  const alternar = async (c: WaChannelAgentInfo) => {
    setMexendo(c.id);
    try {
      await agentsApi.setChannelEnabled(c.id, !c.ai_enabled);
      await onMudou();
    } finally {
      setMexendo(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-slate-500 max-w-2xl">
        Ligar o canal faz o WhatsApp chamar a IA a cada mensagem recebida. O que ela pode fazer
        depende do modo do agente — em sombra, nada sai daqui.
      </p>

      {canais.map(c => (
        <div key={c.id} className={`${CARD} p-4`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-slate-800">{c.name}</h3>
              <p className="text-[12.5px] text-slate-500 mt-0.5">
                {c.primary_agent_name
                  ? <>Agente primário: <strong className="text-slate-700">{c.primary_agent_name}</strong></>
                  : <span className="text-amber-700">Nenhum agente primário ativo — a IA não vai responder</span>}
                {c.agent_count > 0 && ` · ${c.agent_count} agente(s) neste canal`}
              </p>
            </div>

            <button
              type="button" onClick={() => void alternar(c)} disabled={mexendo === c.id}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] font-medium transition shrink-0 ${
                c.ai_enabled
                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {mexendo === c.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : c.ai_enabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              {c.ai_enabled ? 'IA ligada' : 'IA desligada'}
            </button>
          </div>

          {c.stages.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#e7e5df]">
              <span className="block text-[10.5px] uppercase tracking-wide text-slate-400 font-medium mb-1.5">
                Funil deste canal
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {c.stages.map((s, i) => (
                  <React.Fragment key={s}>
                    {i > 0 && <span className="text-slate-300 text-[11px]">→</span>}
                    <span className="text-[11.5px] px-2 py-0.5 rounded-md bg-[#f5f5f3] text-slate-600">{s}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

// ── Decisões ────────────────────────────────────────────────────────────────

const SecaoDecisoes: React.FC<{ runs: WaRunEnriched[]; carregando: boolean }> = ({ runs, carregando }) => {
  const resumo = useMemo(() => agentsApi.summarize(runs), [runs]);

  return (
    <div className="space-y-4">
      <div className={`${CARD} grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#e7e5df] overflow-hidden`}>
        <Numero rotulo="Decisões" valor={resumo.runs} />
        <Numero rotulo="Conversas" valor={resumo.conversations} />
        <Numero rotulo="Mensagens enviadas" valor={resumo.sent} bom={resumo.sent === 0} />
        <Numero rotulo="Gatilhos barrados" valor={resumo.blocked} />
      </div>

      <div className={CARD}>
        {carregando && runs.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-[13px]">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" /> Carregando…
          </div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center">
            <ScrollText className="w-6 h-6 text-slate-300 mx-auto mb-2.5" />
            <p className="text-[13.5px] text-slate-600 font-medium">Nenhuma decisão ainda</p>
            <p className="text-[12.5px] text-slate-400 mt-1 max-w-sm mx-auto">
              Aparece aqui assim que um agente estiver ativo e chegar mensagem no canal dele.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#e7e5df]">
            {runs.map(r => (
              <div key={r.id} className="p-3.5 grid grid-cols-[50px_1fr] sm:grid-cols-[50px_150px_1fr] gap-3 items-start">
                <div className="text-[11.5px] text-slate-400 tabular-nums font-mono leading-tight">
                  {hora(r.created_at)}
                  <span className="block text-[10px]">{dia(r.created_at)}</span>
                </div>
                <div className="min-w-0 hidden sm:block">
                  <span className="block text-[13px] font-medium text-slate-800 truncate">
                    {r.contact_name || 'Sem nome'}
                  </span>
                  <span className="block text-[11px] text-slate-400 font-mono truncate">
                    {r.agent_name || 'agente removido'}
                  </span>
                </div>
                <div className="min-w-0">
                  {r.inbound_text && (
                    <p className="text-[12.5px] text-slate-500 border-l-2 border-[#e7e5df] pl-2.5 mb-1.5 line-clamp-2">
                      {r.inbound_text}
                    </p>
                  )}
                  {r.reply_text && (
                    <p className="text-[13px] text-slate-800 mb-1.5 whitespace-pre-wrap">{r.reply_text}</p>
                  )}
                  {r.error && (
                    <p className="text-[12px] text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5 mb-1.5">{r.error}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.tool_calls.map((t, i) => {
                      const v = VERDITO[t.verdict] ?? VERDITO.simulado;
                      return (
                        <span
                          key={i} title={t.detail || ''}
                          className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${v.classe}`}
                        >
                          <span className="opacity-60">{v.rotulo} </span>{t.name}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Numero: React.FC<{ rotulo: string; valor: number; bom?: boolean }> = ({ rotulo, valor, bom }) => (
  <div className="p-3.5 bg-white">
    <span className="block text-[10.5px] uppercase tracking-wide text-slate-400 font-medium mb-1">{rotulo}</span>
    <span className={`text-[21px] font-semibold tabular-nums ${bom ? 'text-emerald-600' : 'text-slate-800'}`}>
      {valor}
    </span>
  </div>
);

export default AgentConsole;
