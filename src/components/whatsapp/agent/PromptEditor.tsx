/**
 * Editor do prompt do agente.
 *
 * O prompt é um documento em português onde os gatilhos aparecem como menções
 * (`@PedirDocumentos`). A tela valida cada menção contra o catálogo e recusa
 * salvar enquanto houver uma quebrada — é o erro que mais custa caro depois:
 * um `@EnviarProposta` que não existe não vira erro em lugar nenhum, a IA
 * simplesmente ignora a instrução e ninguém entende por que ela não fez.
 *
 * Três níveis, porque "quebrada" não é uma coisa só:
 *   vermelho — não existe no catálogo. Impede salvar.
 *   âmbar    — existe, mas este agente não pode usar (ou o motor ainda não
 *              executa). Salva, mas avisa: a IA não vai receber esse gatilho.
 *   normal   — válida e liberada.
 */
import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, XCircle } from 'lucide-react';
import { WA_AGENT_TOOLS_DISPLAY } from '../../../shared/waAgentTools';
import { waLabel, waTextarea } from '../ui';

/** Captura `@Palavra`. Acentos entram porque as menções são em português. */
const MENCAO = /@([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9_]*)/g;

export type NivelMencao = 'ok' | 'nao_liberada' | 'inexistente';

export interface ProblemaMencao {
  texto: string;
  nivel: Exclude<NivelMencao, 'ok'>;
  motivo: string;
}

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Menção → gatilho. Compara sem acento e sem caixa: quem escreve não deve
 *  precisar acertar o acento de `@MarcarReuniao` para o sistema entender. */
function acharGatilho(mencao: string) {
  const alvo = semAcento(mencao);
  return WA_AGENT_TOOLS_DISPLAY.find(t => semAcento(t.mention.slice(1)) === alvo) ?? null;
}

export function avaliarMencao(mencao: string, liberados: string[]): { nivel: NivelMencao; motivo: string } {
  const gatilho = acharGatilho(mencao);
  if (!gatilho) return { nivel: 'inexistente', motivo: 'não existe no catálogo de gatilhos' };
  if (!gatilho.implemented) return { nivel: 'nao_liberada', motivo: 'o motor ainda não executa este gatilho' };
  if (!liberados.includes(gatilho.name)) {
    return { nivel: 'nao_liberada', motivo: 'não está marcado nos gatilhos liberados deste agente' };
  }
  return { nivel: 'ok', motivo: '' };
}

/** Só as menções com problema, sem repetir. */
export function problemasDoPrompt(prompt: string, liberados: string[]): ProblemaMencao[] {
  const vistas = new Set<string>();
  const problemas: ProblemaMencao[] = [];
  for (const m of prompt.matchAll(MENCAO)) {
    const texto = m[1];
    const chave = semAcento(texto);
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    const { nivel, motivo } = avaliarMencao(texto, liberados);
    if (nivel !== 'ok') problemas.push({ texto, nivel, motivo });
  }
  return problemas;
}

const CLASSE: Record<NivelMencao, string> = {
  ok: 'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  nao_liberada: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  inexistente: 'bg-red-50 text-red-700 ring-1 ring-red-200 underline decoration-wavy',
};

/** O prompt com as menções pintadas. Leitura apenas — editar é no campo acima. */
const Realce: React.FC<{ prompt: string; liberados: string[] }> = ({ prompt, liberados }) => {
  const pedacos = useMemo(() => {
    const out: React.ReactNode[] = [];
    let ultimo = 0;
    let i = 0;
    for (const m of prompt.matchAll(MENCAO)) {
      const inicio = m.index ?? 0;
      if (inicio > ultimo) out.push(prompt.slice(ultimo, inicio));
      const { nivel } = avaliarMencao(m[1], liberados);
      out.push(
        <span key={`m${i++}`} className={`px-1.5 py-0.5 rounded font-mono text-[12px] ${CLASSE[nivel]}`}>
          {m[0]}
        </span>,
      );
      ultimo = inicio + m[0].length;
    }
    if (ultimo < prompt.length) out.push(prompt.slice(ultimo));
    return out;
  }, [prompt, liberados]);

  return (
    <div className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700 max-h-[320px] overflow-y-auto">
      {pedacos}
    </div>
  );
};

export const PromptEditor: React.FC<{
  value: string;
  onChange: (v: string) => void;
  liberados: string[];
}> = ({ value, onChange, liberados }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [paleta, setPaleta] = useState(false);
  const problemas = useMemo(() => problemasDoPrompt(value, liberados), [value, liberados]);

  /** Insere no cursor, não no fim — senão a menção cai longe de onde se escreve. */
  const inserir = (mencao: string) => {
    const el = ref.current;
    if (!el) { onChange(`${value}${mencao} `); setPaleta(false); return; }
    const ini = el.selectionStart ?? value.length;
    const fim = el.selectionEnd ?? ini;
    const novo = `${value.slice(0, ini)}${mencao} ${value.slice(fim)}`;
    onChange(novo);
    setPaleta(false);
    requestAnimationFrame(() => {
      el.focus();
      const pos = ini + mencao.length + 1;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className={`${waLabel} mb-0`}>Instruções</label>
        <div className="relative">
          <button
            type="button" onClick={() => setPaleta(p => !p)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 px-2.5 py-1.5 rounded-lg transition"
          >
            <Plus className="w-3.5 h-3.5" /> Inserir gatilho
          </button>

          {paleta && (
            <div className="absolute right-0 z-20 mt-1.5 w-[300px] max-h-[280px] overflow-y-auto bg-white rounded-xl shadow-lg ring-1 ring-black/[0.08] p-1.5">
              {WA_AGENT_TOOLS_DISPLAY.filter(t => t.implemented && liberados.includes(t.name)).map(t => (
                <button
                  key={t.name} type="button" onClick={() => inserir(t.mention)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-[#f5f5f3] transition"
                >
                  <span className="block font-mono text-[12px] text-teal-700">{t.mention}</span>
                  <span className="block text-[11.5px] text-slate-500 leading-snug">{t.description}</span>
                </button>
              ))}
              {!WA_AGENT_TOOLS_DISPLAY.some(t => t.implemented && liberados.includes(t.name)) && (
                <p className="px-2.5 py-3 text-[12px] text-slate-500">
                  Nenhum gatilho liberado ainda. Marque algum na lista abaixo.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <textarea
        ref={ref}
        className={`${waTextarea} min-h-[260px] font-mono text-[12.5px] leading-relaxed`}
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
      />

      {problemas.length > 0 && (
        <div className="rounded-xl bg-[#faf9f7] ring-1 ring-black/[0.04] p-2.5 space-y-1.5">
          {problemas.map(p => (
            <div key={p.texto} className="flex items-start gap-2 text-[12px]">
              {p.nivel === 'inexistente'
                ? <XCircle className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-amber-600 mt-0.5 shrink-0" />}
              <span className={p.nivel === 'inexistente' ? 'text-red-700' : 'text-amber-700'}>
                <span className="font-mono">@{p.texto}</span> — {p.motivo}
              </span>
            </div>
          ))}
        </div>
      )}

      <details className="group">
        <summary className="cursor-pointer text-[12px] text-slate-500 hover:text-slate-700 select-none">
          Ver como o sistema lê o prompt
        </summary>
        <div className="mt-2 rounded-xl bg-[#faf9f7] ring-1 ring-black/[0.04] p-3">
          <Realce prompt={value} liberados={liberados} />
        </div>
      </details>
    </div>
  );
};

export default PromptEditor;
