/**
 * Os campos da ação "Transferir atendimento": tipo, destino e os textos.
 *
 * Tudo aqui é escolha por clique. Nenhum campo pede uuid, nome digitado nem
 * `{{variavel}}` de memória — as listas saem do cadastro real (setores, equipe,
 * acessos do canal) e as variáveis são chips que se inserem na posição do
 * cursor. As regras de quem pode receber ficam em `funnelTransferTargets.ts`,
 * que é puro e testado; este arquivo é só a tela.
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Building2, Check, ChevronDown, Search, UserRound, X,
} from 'lucide-react';
import { LAYER } from '../../styles/layers';
import {
  EXPLICACAO_INDISPONIVEL, FUNNEL_DESTINATION_KINDS, ROTULO_TIPO_DESTINO,
  filtraDestinos, insereVariavel, opcoesDeDestino, previaComExemplos, resolveDestino,
  type FontesDeDestino, type FunnelDestinationKind, type FunnelDestinationOption,
  type VariavelDeMensagem,
} from './funnelTransferTargets';

/** A partir de quantos registros a busca aparece. Abaixo disso ela só atrapalha. */
const LIMIAR_DE_BUSCA = 7;

const ICONE_TIPO: Record<FunnelDestinationKind, React.ReactNode> = {
  department: <Building2 size={13} />,
  user: <UserRound size={13} />,
};

// ── Seletor de tipo ─────────────────────────────────────────────────────────

interface TipoDeDestinoProps {
  valor: FunnelDestinationKind;
  onChange: (kind: FunnelDestinationKind) => void;
  stageKey: string;
}

export const TipoDeDestino: React.FC<TipoDeDestinoProps> = ({ valor, onChange, stageKey }) => (
  <div role="radiogroup" aria-label="Tipo de destino" className="mt-1 flex gap-1.5">
    {FUNNEL_DESTINATION_KINDS.map(kind => (
      <button key={kind} type="button" role="radio" aria-checked={valor === kind}
        data-testid={`destination-kind-${kind}-${stageKey}`}
        onClick={() => onChange(kind)}
        className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${
          valor === kind
            ? 'border-violet-300 bg-violet-50 text-violet-800'
            : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200'
        }`}>
        {ICONE_TIPO[kind]}{ROTULO_TIPO_DESTINO[kind]}
      </button>
    ))}
  </div>
);

// ── Seletor de destino ──────────────────────────────────────────────────────

interface DestinoProps {
  kind: FunnelDestinationKind;
  fontes: FontesDeDestino;
  /** O que está salvo, já resolvido contra o cadastro atual. */
  resolucao: ReturnType<typeof resolveDestino>;
  onSelect: (opcao: FunnelDestinationOption) => void;
  stageKey: string;
}

export const SeletorDeDestino: React.FC<DestinoProps> = ({ kind, fontes, resolucao, onSelect, stageKey }) => {
  const [aberto, setAberto] = useState(false);
  const [consulta, setConsulta] = useState('');

  const opcoes = useMemo(() => opcoesDeDestino(kind, fontes), [kind, fontes]);
  const visiveis = useMemo(() => filtraDestinos(opcoes, consulta), [opcoes, consulta]);
  const mostraBusca = opcoes.length >= LIMIAR_DE_BUSCA;

  const rotulo = resolucao.status === 'vazio'
    ? (kind === 'department' ? 'Escolher setor…' : 'Escolher pessoa…')
    : (resolucao.nome || 'Destino removido');

  const problema = resolucao.status === 'sumiu' || resolucao.status === 'indisponivel';

  return (
    <div className="relative mt-1">
      <button type="button" onClick={() => { setAberto(open => !open); setConsulta(''); }}
        aria-haspopup="listbox" aria-expanded={aberto}
        data-testid={`destination-open-${stageKey}`}
        className={`flex w-full items-center gap-2 rounded-lg border bg-white px-2.5 py-2 text-left text-xs outline-none transition ${
          problema ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 hover:border-violet-300'
        }`}>
        <span className={problema ? 'text-amber-600' : 'text-slate-400'}>
          {problema ? <AlertTriangle size={13} /> : ICONE_TIPO[kind]}
        </span>
        <span className={`min-w-0 flex-1 truncate ${resolucao.status === 'vazio' ? 'text-slate-400' : 'font-semibold text-slate-800'}`}>
          {rotulo}
        </span>
        <ChevronDown size={14} className="shrink-0 text-slate-400" />
      </button>

      {/* O destino salvo NUNCA é trocado sozinho: o aviso fica, e a troca é um
          clique explícito de quem está editando. */}
      {resolucao.aviso && (
        <p data-testid={`destination-warning-${stageKey}`}
          className="mt-1 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-medium leading-relaxed text-amber-800">
          <AlertTriangle size={11} className="mt-px shrink-0" />
          <span>{resolucao.aviso}</span>
        </p>
      )}

      {aberto && (
        <>
          {/* Sem as classes `fixed`/`inset-0`: a "correção global de modais" do
              index.css casa por SUBSTRING de classe e pinta QUALQUER uma delas
              de preto 60% com blur — o apanhador de clique de um dropdown
              virava um scrim sobre a tela inteira. Em estilo inline ela não
              alcança. */}
          <div aria-hidden onClick={() => setAberto(false)}
            style={{ position: 'fixed', inset: 0, zIndex: LAYER.POPOVER - 1 }} />
          <div role="listbox"
            style={{ zIndex: LAYER.POPOVER }}
            className="absolute left-0 right-0 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {mostraBusca && (
              <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
                <Search size={12} className="shrink-0 text-slate-400" />
                <input autoFocus value={consulta} onChange={event => setConsulta(event.target.value)}
                  placeholder="Pesquisar pelo nome…" aria-label="Pesquisar destino"
                  data-testid={`destination-search-${stageKey}`}
                  className="min-w-0 flex-1 text-xs outline-none placeholder:text-slate-400" />
                {consulta && (
                  <button type="button" onClick={() => setConsulta('')} aria-label="Limpar pesquisa" className="shrink-0 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            <div className="max-h-52 overflow-y-auto py-1">
              {visiveis.length === 0 && (
                <p className="px-3 py-3 text-center text-[11px] text-slate-400">
                  {opcoes.length === 0
                    ? (kind === 'department' ? 'Nenhum setor cadastrado.' : 'Nenhum atendente cadastrado.')
                    : 'Nada encontrado com esse nome.'}
                </p>
              )}
              {visiveis.map(opcao => {
                const escolhida = opcao.id === resolucao.id;
                return (
                  <button key={opcao.id} type="button" role="option" aria-selected={escolhida}
                    disabled={!!opcao.indisponivel}
                    data-testid={`destination-option-${opcao.id}`}
                    onClick={() => { onSelect(opcao); setAberto(false); setConsulta(''); }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition ${
                      opcao.indisponivel
                        ? 'cursor-not-allowed opacity-55'
                        : escolhida ? 'bg-violet-50 text-violet-800' : 'hover:bg-slate-50'
                    }`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{opcao.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {opcao.indisponivel ? EXPLICACAO_INDISPONIVEL[opcao.indisponivel] : (opcao.detail || '')}
                      </span>
                    </span>
                    {escolhida && <Check size={13} className="shrink-0 text-violet-600" />}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ── Campo de texto com variáveis clicáveis ──────────────────────────────────

interface CampoComVariaveisProps {
  rotulo: React.ReactNode;
  valor: string;
  onChange: (texto: string) => void;
  variaveis: readonly VariavelDeMensagem[];
  /**
   * Valores já conhecidos (o destino escolhido), para a prévia não mentir.
   * Ausentes, a prévia se anuncia como EXEMPLO — dizer "fica assim: …para
   * Atendimento" com o destino ainda vazio é afirmar o que não é verdade.
   */
  valoresReais?: Readonly<Record<string, string>>;
  multilinha?: boolean;
  placeholder?: string;
  testId: string;
}

export const CampoComVariaveis: React.FC<CampoComVariaveisProps> = ({
  rotulo, valor, onChange, variaveis, valoresReais, multilinha = false, placeholder, testId,
}) => {
  const campoRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // A última posição do cursor precisa sobreviver ao clique no chip: o botão
  // rouba o foco antes do `onClick`, e nesse instante `selectionStart` já voltou
  // ao fim do texto. Sem esta memória, todo chip caía no final da frase.
  const cursorRef = useRef<{ inicio: number; fim: number }>({ inicio: valor.length, fim: valor.length });
  // Sem foco e sem clique anterior, o token vai para o FIM do texto atual — e é
  // o texto atual que importa, não o do primeiro render. `insereVariavel` ainda
  // grampeia a posição ao tamanho, então uma memória velha nunca estoura.
  if (cursorRef.current.inicio > valor.length) cursorRef.current = { inicio: valor.length, fim: valor.length };
  /**
   * Onde o cursor deve parar depois da PRÓXIMA pintura.
   *
   * Reposicionar logo após o `onChange` (ou dentro de um `requestAnimationFrame`)
   * não funciona: o valor ainda é o antigo quando a linha roda, e a repintura
   * seguinte joga o cursor para o fim do texto — o token entrava no lugar certo
   * e a digitação continuava no fim da frase.
   */
  const cursorPendenteRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const alvo = cursorPendenteRef.current;
    if (alvo === null) return;
    cursorPendenteRef.current = null;
    const campo = campoRef.current;
    if (!campo) return;
    campo.focus();
    campo.setSelectionRange(alvo, alvo);
  }, [valor]);

  const lembraCursor = () => {
    const campo = campoRef.current;
    if (!campo) return;
    cursorRef.current = {
      inicio: campo.selectionStart ?? valor.length,
      fim: campo.selectionEnd ?? valor.length,
    };
  };

  const insere = (token: string) => {
    // A seleção VIVA do campo manda quando ele ainda está focado — é o caso
    // normal, porque `onMouseDown` do chip impede o roubo de foco. A memória só
    // entra quando o foco já saiu (o usuário clicou noutro lugar antes do chip);
    // e ela nunca é a primeira escolha porque envelhece: trocar o tipo de
    // destino troca o texto-padrão inteiro, e a posição guardada passaria a
    // apontar para além do fim da frase nova.
    const campo = campoRef.current;
    const focado = campo && document.activeElement === campo;
    const { inicio, fim } = focado
      ? { inicio: campo.selectionStart ?? valor.length, fim: campo.selectionEnd ?? valor.length }
      : cursorRef.current;
    // A inserção mora no módulo puro: é ela que cuida do espaço em volta e diz
    // onde o cursor deve parar.
    const resultado = insereVariavel(valor, inicio, fim, token);
    cursorRef.current = { inicio: resultado.cursor, fim: resultado.cursor };
    cursorPendenteRef.current = resultado.cursor;
    onChange(resultado.texto);
  };

  const propsComuns = {
    value: valor,
    placeholder,
    'data-testid': testId,
    onChange: (event: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => onChange(event.target.value),
    onSelect: lembraCursor,
    onKeyUp: lembraCursor,
    onClick: lembraCursor,
    onBlur: lembraCursor,
    className: 'mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-violet-300',
  };

  const previa = valor.trim() ? previaComExemplos(valor, variaveis, valoresReais) : '';

  return (
    <div className="text-[10px] font-semibold text-slate-500">
      {rotulo}
      {multilinha
        ? <textarea {...propsComuns} rows={2} ref={campoRef as React.RefObject<HTMLTextAreaElement>} className={`${propsComuns.className} resize-y`} />
        : <input {...propsComuns} ref={campoRef as React.RefObject<HTMLInputElement>} />}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-0.5 font-normal text-slate-400">Inserir:</span>
        {variaveis.map(variavel => (
          <button key={variavel.token} type="button"
            title={`${variavel.descricao} Exemplo: ${variavel.exemplo}`}
            data-testid={`${testId}-var-${variavel.token.replace(/[{}.]/g, '')}`}
            onMouseDown={event => event.preventDefault()}
            onClick={() => insere(variavel.token)}
            className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700">
            {variavel.rotulo}
          </button>
        ))}
      </div>

      {previa && previa !== valor && (
        <p className="mt-1 rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-normal leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-500">
            {valoresReais ? 'Fica assim: ' : 'Exemplo: '}
          </span>{previa}
        </p>
      )}
    </div>
  );
};
