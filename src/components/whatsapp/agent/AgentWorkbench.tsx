/**
 * Bancada do atendente de IA: o log do modo sombra e a configuração dos agentes.
 *
 * Fica FORA do WhatsAppModule.tsx de propósito — aquele arquivo já tem 3 mil
 * linhas, e configuração de agente não é operação de inbox.
 *
 * O catálogo de gatilhos é importado do módulo compartilhado com o motor: a
 * lista que a tela mostra é literalmente a que o servidor obedece, então não há
 * como a tela oferecer um gatilho que o motor não conhece.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Loader2, RefreshCw, ShieldAlert, Eye, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { WA_AGENT_TOOLS_DISPLAY } from '../../../shared/waAgentTools';
import {
  agentsApi, type WaAgent, type WaAgentMode, type WaRunEnriched, type WaRunVerdict,
} from '../../../services/whatsapp/agents';
import { waBtnGhost, waBtnPrimary, waInput, waLabel, waSelect } from '../ui';
import PromptEditor, { problemasDoPrompt } from './PromptEditor';

const CARD = 'bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/[0.04]';
const LINE = 'border-[#e7e5df]';

const MODOS: Array<{ v: WaAgentMode; label: string; hint: string }> = [
  { v: 'sombra', label: 'Sombra', hint: 'Decide e registra. Não envia nada, não altera nada.' },
  { v: 'aprovacao', label: 'Aprovação', hint: 'Escreve a resposta e espera alguém aprovar.' },
  { v: 'automatico', label: 'Automático', hint: 'Responde e executa sozinho. Risco alto continua pedindo aprovação.' },
];

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

const horaDe = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaDe = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

export const AgentWorkbench: React.FC<{ currentUserId?: string | null }> = ({ currentUserId }) => {
  const [aba, setAba] = useState<'sombra' | 'agentes'>('sombra');
  const [agentes, setAgentes] = useState<WaAgent[]>([]);
  const [runs, setRuns] = useState<WaRunEnriched[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [as, rs] = await Promise.all([agentsApi.list(), agentsApi.runs(60)]);
      setAgentes(as);
      setRuns(rs);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const resumo = useMemo(() => agentsApi.summarize(runs), [runs]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Bot className="w-5 h-5 text-amber-600" />
          <div>
            <h2 className="text-[15px] font-semibold text-slate-800 leading-tight">Atendente de IA</h2>
            <p className="text-[12.5px] text-slate-500">O que ele decidiu, e como ele está configurado.</p>
          </div>
        </div>
        <button type="button" onClick={() => void carregar()} className={waBtnGhost} disabled={carregando}>
          {carregando ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Atualizar
        </button>
      </div>

      <div className={`flex gap-1 p-1 rounded-xl bg-[#f5f5f3] border ${LINE} w-fit`}>
        {(['sombra', 'agentes'] as const).map(k => (
          <button
            key={k} type="button" onClick={() => setAba(k)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition ${
              aba === k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            {k === 'sombra' ? 'Decisões' : 'Agentes'}
          </button>
        ))}
      </div>

      {erro && (
        <div className={`${CARD} p-3.5 flex items-start gap-2.5 text-[13px] text-red-700`}>
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {aba === 'sombra'
        ? <PainelDecisoes runs={runs} resumo={resumo} carregando={carregando} />
        : <PainelAgentes agentes={agentes} currentUserId={currentUserId} onSalvo={carregar} />}
    </div>
  );
};

// ── Decisões ────────────────────────────────────────────────────────────────

const PainelDecisoes: React.FC<{
  runs: WaRunEnriched[];
  resumo: ReturnType<typeof agentsApi.summarize>;
  carregando: boolean;
}> = ({ runs, resumo, carregando }) => (
  <div className="space-y-4">
    <div className={`${CARD} grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 ${LINE} overflow-hidden`}>
      <Numero rotulo="Decisões" valor={resumo.runs} />
      <Numero rotulo="Conversas" valor={resumo.conversations} />
      <Numero rotulo="Mensagens enviadas" valor={resumo.sent} bom={resumo.sent === 0} />
      <Numero rotulo="Gatilhos barrados" valor={resumo.blocked} />
    </div>

    <div className={CARD}>
      {carregando && runs.length === 0 ? (
        <div className="p-10 text-center text-slate-400 text-[13px]">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Carregando…
        </div>
      ) : runs.length === 0 ? (
        <div className="p-10 text-center">
          <Eye className="w-6 h-6 text-slate-300 mx-auto mb-2.5" />
          <p className="text-[13.5px] text-slate-600 font-medium">Nenhuma decisão ainda</p>
          <p className="text-[12.5px] text-slate-400 mt-1 max-w-sm mx-auto">
            O agente registra aqui assim que estiver ativo e chegar mensagem no canal dele.
          </p>
        </div>
      ) : (
        <div className={`divide-y ${LINE}`}>
          {runs.map(r => <LinhaDecisao key={r.id} run={r} />)}
        </div>
      )}
    </div>
  </div>
);

const Numero: React.FC<{ rotulo: string; valor: number; bom?: boolean }> = ({ rotulo, valor, bom }) => (
  <div className="p-3.5 bg-white">
    <span className="block text-[10.5px] uppercase tracking-wide text-slate-400 font-medium mb-1">{rotulo}</span>
    <span className={`text-[21px] font-semibold tabular-nums ${bom ? 'text-emerald-600' : 'text-slate-800'}`}>
      {valor}
    </span>
  </div>
);

const LinhaDecisao: React.FC<{ run: WaRunEnriched }> = ({ run }) => (
  <div className="p-3.5 grid grid-cols-[52px_1fr] sm:grid-cols-[52px_150px_1fr] gap-3 items-start">
    <div className="text-[12px] text-slate-400 tabular-nums font-mono leading-tight">
      {horaDe(run.created_at)}
      <span className="block text-[10.5px]">{diaDe(run.created_at)}</span>
    </div>

    <div className="min-w-0 hidden sm:block">
      <span className="block text-[13.5px] font-medium text-slate-800 truncate">
        {run.contact_name || 'Sem nome'}
      </span>
      <span className="block text-[11.5px] text-slate-400 font-mono truncate">
        {run.agent_name || 'agente removido'}
      </span>
    </div>

    <div className="min-w-0">
      {run.inbound_text && (
        <p className="text-[13px] text-slate-500 border-l-2 border-[#e7e5df] pl-2.5 mb-2 line-clamp-2">
          {run.inbound_text}
        </p>
      )}

      {run.reply_text && (
        <p className="text-[13.5px] text-slate-800 mb-2 whitespace-pre-wrap">{run.reply_text}</p>
      )}

      {run.error && (
        <p className="text-[12.5px] text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5 mb-2">{run.error}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {run.tool_calls.map((t, i) => {
          const v = VERDITO[t.verdict] ?? VERDITO.simulado;
          return (
            <span
              key={i}
              title={t.detail || ''}
              className={`inline-flex items-center gap-1.5 text-[11.5px] font-mono px-2 py-1 rounded-md ${v.classe}`}
            >
              <span className="opacity-60">{v.rotulo}</span>
              {t.name}
            </span>
          );
        })}
        {!run.executed && run.tool_calls.length > 0 && (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-slate-400">
            <Clock className="w-3 h-3" /> nada foi executado
          </span>
        )}
      </div>
    </div>
  </div>
);

// ── Agentes ─────────────────────────────────────────────────────────────────

const PainelAgentes: React.FC<{
  agentes: WaAgent[];
  currentUserId?: string | null;
  onSalvo: () => Promise<void> | void;
}> = ({ agentes, currentUserId, onSalvo }) => {
  const [selId, setSelId] = useState<string | null>(null);
  const sel = agentes.find(a => a.id === selId) ?? agentes[0] ?? null;

  if (!agentes.length) {
    return (
      <div className={`${CARD} p-10 text-center`}>
        <Bot className="w-6 h-6 text-slate-300 mx-auto mb-2.5" />
        <p className="text-[13.5px] text-slate-600 font-medium">Nenhum agente cadastrado</p>
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4">
      <div className={`${CARD} p-1.5 h-fit`}>
        {agentes.map(a => (
          <button
            key={a.id} type="button" onClick={() => setSelId(a.id)}
            className={`w-full text-left px-2.5 py-2 rounded-xl transition ${
              sel?.id === a.id ? 'bg-[#f5f5f3]' : 'hover:bg-[#faf9f7]'}`}
          >
            <span className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${a.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="text-[13.5px] font-medium text-slate-800 truncate">{a.name}</span>
            </span>
            <span className="block text-[11.5px] text-slate-400 mt-0.5">
              {a.role}{a.is_primary ? ' · primário' : ''} · {a.mode}
            </span>
          </button>
        ))}
      </div>

      {sel && <EditorAgente key={sel.id} agente={sel} currentUserId={currentUserId} onSalvo={onSalvo} />}
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

  // Menção que não existe no catálogo trava o salvamento. A IA ignoraria a
  // instrução em silêncio, e ninguém entenderia por que ela não fez o passo.
  const quebradas = problemasDoPrompt(prompt, tools).filter(p => p.nivel === 'inexistente');

  const alternar = (nome: string) =>
    setTools(t => (t.includes(nome) ? t.filter(x => x !== nome) : [...t, nome]));

  const salvar = async () => {
    setSalvando(true);
    setAviso(null);
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
    <div className="space-y-4">
      <div className={`${CARD} p-4 space-y-3.5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-[14.5px] font-semibold text-slate-800">{agente.name}</h3>
            <p className="text-[12.5px] text-slate-500">{agente.description || 'Sem descrição'}</p>
          </div>
          <span className="text-[11.5px] text-slate-400 font-mono">v{agente.version}</span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={waLabel}>Modo</label>
            <select className={waSelect} value={modo} onChange={e => setModo(e.target.value as WaAgentMode)}>
              {MODOS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
            <p className="mt-1.5 text-[11.5px] text-slate-500 leading-snug">
              {MODOS.find(m => m.v === modo)?.hint}
            </p>
          </div>

          <div>
            <label className={waLabel}>Agrupar mensagens (segundos)</label>
            <input
              type="number" min={0} max={120} className={waInput}
              value={debounce}
              onChange={e => setDebounce(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
            />
            <p className="mt-1.5 text-[11.5px] text-slate-500 leading-snug">
              Espera o cliente terminar de digitar antes de responder.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-amber-600"
          />
          <span>
            <span className="block text-[13.5px] font-medium text-slate-800">Agente ativo</span>
            <span className="block text-[12px] text-slate-500">
              Desligado, ele não atende nem registra. É o interruptor mais rápido.
            </span>
          </span>
        </label>
      </div>

      <div className={`${CARD} p-4`}>
        <PromptEditor value={prompt} onChange={setPrompt} liberados={tools} />
        <p className="mt-2 text-[11.5px] text-slate-500">
          Escreva em português, com exemplos do que dizer. Ao salvar, a versão anterior é guardada.
        </p>
      </div>

      <div className={`${CARD} p-4`}>
        <label className={waLabel}>Gatilhos liberados</label>
        <p className="text-[12px] text-slate-500 mb-2.5 leading-snug">
          O que não estiver marcado não é oferecido à IA — ela nem sabe que existe.
        </p>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {WA_AGENT_TOOLS_DISPLAY.map(t => (
            <label
              key={t.name}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-xl border ${LINE} ${
                t.implemented ? 'cursor-pointer hover:bg-[#faf9f7]' : 'opacity-45 cursor-not-allowed'}`}
              title={t.implemented ? t.description : 'Ainda não executado pelo motor'}
            >
              <input
                type="checkbox" disabled={!t.implemented}
                checked={tools.includes(t.name)} onChange={() => alternar(t.name)}
                className="w-4 h-4 accent-amber-600 shrink-0"
              />
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-mono text-slate-800 truncate">{t.name}</span>
              </span>
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${RISCO[t.risk]}`}>
                {t.risk}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2.5 text-[11.5px] text-slate-500 leading-snug">
          Gatilho de risco <strong>alto</strong> sempre pede aprovação humana, mesmo em modo automático.
        </p>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        <button
          type="button" className={waBtnPrimary} onClick={() => void salvar()}
          disabled={!mudou || salvando || quebradas.length > 0}
          title={quebradas.length ? 'Corrija as menções quebradas antes de salvar' : undefined}
        >
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Salvar
        </button>
        {quebradas.length > 0 && (
          <span className="text-[12.5px] text-red-700 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5" />
            {quebradas.length === 1
              ? `@${quebradas[0].texto} não existe`
              : `${quebradas.length} menções não existem`}
          </span>
        )}
        {aviso && (
          <span className={`text-[12.5px] flex items-center gap-1.5 ${
            aviso === 'Salvo.' ? 'text-emerald-700' : 'text-red-700'}`}>
            {aviso === 'Salvo.' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {aviso}
          </span>
        )}
      </div>
    </div>
  );
};

export default AgentWorkbench;
