// ─── Jurius Processos ─────────────────────────────────────────────────────────
// Cliente do serviço de vigilância processual (repositório `jurius-processos`).
//
// O acervo deste serviço é MAIOR que o cadastro do CRM: ele parte das OABs do
// escritório e conhece processos que ninguém chegou a cadastrar. Por isso o
// vínculo com `processes` é opcional — `crm_process_id` pode vir nulo.
//
// Enquanto o serviço não estiver publicado, `VITE_JURIUS_PROCESSOS_URL` fica
// vazia e `juriusProcessosDisponivel()` devolve false: a tela deve continuar
// funcionando pelo caminho antigo (Supabase) em vez de quebrar.

const BASE_URL = (import.meta.env.VITE_JURIUS_PROCESSOS_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// Token PÚBLICO: barra varredura anônima, não separa usuários. Vai no bundle e
// qualquer um com o CRM aberto o lê no devtools — mesma natureza do token do
// Jurius Call. A migração para o JWT do Supabase é um passo posterior.
const TOKEN = (import.meta.env.VITE_JURIUS_PROCESSOS_TOKEN as string | undefined) ?? 'jurius-processos-publico';

export type FaseProcesso =
  | 'desconhecida'
  | 'distribuicao'
  | 'conhecimento'
  | 'instrucao'
  | 'sentenciado'
  | 'recursal'
  | 'transitado'
  | 'cumprimento_sentenca'
  | 'execucao'
  | 'suspenso'
  | 'arquivado'
  | 'baixado';

export type SituacaoProcesso = 'ativo' | 'suspenso' | 'arquivado' | 'baixado';
export type SaudeProcesso = 'ok' | 'atencao' | 'critico' | 'sem_dados';

export type TipoPendencia =
  | 'execucao_pendente'
  | 'prazo_em_aberto'
  | 'prazo_vencido_sem_resposta'
  | 'valor_a_levantar'
  | 'audiencia_designada'
  | 'parado_demais'
  | 'suspensao_esquecida'
  | 'sem_linha_do_tempo';

export interface PendenciaProcesso {
  id: string;
  processo_id: string;
  tipo: TipoPendencia;
  severidade: 'baixa' | 'media' | 'alta' | 'critica';
  titulo: string;
  descricao: string | null;
  referencia_tipo: 'movimento' | 'publicacao' | 'derivado' | null;
  referencia_id: string | null;
  data_referencia: string | null;
  prazo_em: string | null;
  /** Presente quando a pendência vem da listagem geral, não da ficha do processo. */
  numero_formatado?: string;
  crm_cliente_nome?: string | null;
  crm_process_id?: string | null;
}

export interface ProcessoVigiado {
  id: string;
  numero: string;
  numero_formatado: string | null;
  tribunal: string | null;
  uf: string | null;
  grau: string | null;
  classe_nome: string | null;
  assuntos: { codigo?: number; nome?: string }[];
  orgao_julgador: string | null;
  data_ajuizamento: string | null;
  valor_causa: number | null;
  fase: FaseProcesso;
  fase_rotulo: string;
  fase_motivo: string | null;
  fase_em: string | null;
  situacao: SituacaoProcesso;
  saude: SaudeProcesso;
  origens: ('djen' | 'datajud' | 'crm')[];
  crm_process_id: string | null;
  crm_client_id: string | null;
  crm_cliente_nome: string | null;
  ultima_movimentacao_em: string | null;
  dias_sem_movimentacao: number | null;
  total_movimentos: number;
  total_publicacoes: number;
  total_pendencias: number;
  datajud_erro: string | null;
  pendencias?: PendenciaProcesso[];
}

export interface EventoTimeline {
  id: string;
  origem: 'movimento' | 'publicacao';
  data: string;
  titulo: string;
  texto: string | null;
  categoria: string;
  grau: string | null;
  orgao: string | null;
  link: string | null;
  prazo_em: string | null;
  codigo: number | null;
}

export interface ListaProcessos {
  total: number;
  limite: number;
  deslocamento: number;
  itens: ProcessoVigiado[];
}

export interface FiltroProcessos {
  fase?: FaseProcesso[];
  situacao?: SituacaoProcesso[];
  saude?: SaudeProcesso[];
  tribunal?: string[];
  q?: string;
  cliente_id?: string;
  com_pendencia?: boolean;
  fora_do_crm?: boolean;
  parado_ha_dias?: number;
  ordem?: 'recentes' | 'antigos' | 'parados' | 'pendencias' | 'numero';
  limite?: number;
  deslocamento?: number;
}

export function juriusProcessosDisponivel(): boolean {
  return Boolean(BASE_URL);
}

class ServicoIndisponivelError extends Error {
  constructor() {
    super('Serviço de processos não configurado (VITE_JURIUS_PROCESSOS_URL).');
  }
}

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new ServicoIndisponivelError();

  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), 20_000);

  try {
    const resposta = await fetch(`${BASE_URL}${caminho}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controlador.signal,
    });

    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => ({}));
      throw new Error(corpo?.erro ?? `Erro ${resposta.status} ao consultar o serviço de processos.`);
    }

    return (await resposta.json()) as T;
  } catch (erro: any) {
    if (erro?.name === 'AbortError') {
      throw new Error('O serviço de processos não respondeu em 20 s.');
    }
    throw erro;
  } finally {
    clearTimeout(limite);
  }
}

function montarQuery(filtro: FiltroProcessos): string {
  const params = new URLSearchParams();
  const lista = (chave: string, valores?: string[]) => {
    if (valores?.length) params.set(chave, valores.join(','));
  };

  lista('fase', filtro.fase);
  lista('situacao', filtro.situacao);
  lista('saude', filtro.saude);
  lista('tribunal', filtro.tribunal);

  if (filtro.q) params.set('q', filtro.q);
  if (filtro.cliente_id) params.set('cliente_id', filtro.cliente_id);
  if (filtro.com_pendencia) params.set('com_pendencia', 'true');
  if (filtro.fora_do_crm) params.set('fora_do_crm', 'true');
  if (filtro.parado_ha_dias) params.set('parado_ha_dias', String(filtro.parado_ha_dias));
  if (filtro.ordem) params.set('ordem', filtro.ordem);
  if (filtro.limite) params.set('limite', String(filtro.limite));
  if (filtro.deslocamento) params.set('deslocamento', String(filtro.deslocamento));

  const texto = params.toString();
  return texto ? `?${texto}` : '';
}

export const juriusProcessosService = {
  disponivel: juriusProcessosDisponivel,

  status: () => pedir<any>('/api/status'),

  listar: (filtro: FiltroProcessos = {}) => pedir<ListaProcessos>(`/api/processos${montarQuery(filtro)}`),

  obter: (numero: string) => pedir<ProcessoVigiado>(`/api/processos/${encodeURIComponent(numero)}`),

  timeline: (numero: string, limite = 500) =>
    pedir<{ processo: ProcessoVigiado; total: number; eventos: EventoTimeline[] }>(
      `/api/processos/${encodeURIComponent(numero)}/timeline?limite=${limite}`,
    ),

  pendencias: (opcoes: { tipo?: TipoPendencia[]; severidade?: string[]; limite?: number } = {}) => {
    const params = new URLSearchParams();
    if (opcoes.tipo?.length) params.set('tipo', opcoes.tipo.join(','));
    if (opcoes.severidade?.length) params.set('severidade', opcoes.severidade.join(','));
    if (opcoes.limite) params.set('limite', String(opcoes.limite));
    return pedir<{ total: number; itens: PendenciaProcesso[] }>(`/api/pendencias?${params}`);
  },

  /** Busca em texto integral no que os tribunais publicaram. */
  buscar: (termo: string, limite = 30) =>
    pedir<{ termo: string; total: number; itens: any[] }>(
      `/api/busca?q=${encodeURIComponent(termo)}&limite=${limite}`,
    ),

  estatisticas: () => pedir<any>('/api/estatisticas'),

  /** Panorama compacto do acervo — a entrada pensada para a IA. */
  panorama: (amostra = 15) => pedir<any>(`/api/ia/panorama?amostra=${amostra}`),

  /** Passa a vigiar um número que o serviço ainda não conhecia. */
  adicionar: (numero: string) =>
    pedir<ProcessoVigiado>('/api/processos', { method: 'POST', body: JSON.stringify({ numero }) }),

  /** Força uma consulta ao DataJud deste processo, ignorando o intervalo normal. */
  sincronizarUm: (numero: string) =>
    pedir<{ ok: boolean; novos: number; erro: string | null }>(
      `/api/sync/processo/${encodeURIComponent(numero)}`,
      { method: 'POST' },
    ),
};
