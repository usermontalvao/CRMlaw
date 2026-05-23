// ─── DataJud Service ──────────────────────────────────────────────────────────
// API pública do CNJ — consulta movimentações processuais de todos os tribunais
// Chamadas passam pela Edge Function datajud-proxy (evita bloqueio CORS).
// Documentação: https://datajud-wiki.cnj.jus.br/api-publica/

import { settingsService } from './settings.service';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const DATAJUD_PROXY_URL = `${SUPABASE_URL}/functions/v1/datajud-proxy`;

// ── Tipos ──────────────────────────────────────────────────────────────────────

export interface DatajudComplemento {
  codigo: number;
  valor: number;
  nome: string;
  descricao: string;
}

export interface DatajudMovimento {
  codigo: number;
  nome: string;
  dataHora: string;
  complementosTabelados?: DatajudComplemento[];
  orgaoJulgador?: { codigoOrgao: number; nomeOrgao: string };
}

export interface DatajudProcesso {
  id: string;
  numeroProcesso: string;
  tribunal: string;
  grau: string;
  dataAjuizamento: string;
  dataHoraUltimaAtualizacao: string;
  classe: { codigo: number; nome: string };
  assuntos: { codigo: number; nome: string }[];
  orgaoJulgador: { codigo: number; nome: string; codigoMunicipioIBGE: number };
  movimentos: DatajudMovimento[];
  nivelSigilo: number;
}

export interface DatajudResult {
  processo: DatajudProcesso | null;
  tribunal: string | null;
  error?: string;
}

// ── Mapeamento CNJ → alias do tribunal ────────────────────────────────────────
// Formato CNJ (20 dígitos): NNNNNNNDDAAAAJTTOOOO
// J (pos 13) = segmento da justiça, TT (pos 14-15) = código do tribunal

// Ordem alfabética dos nomes dos estados em português (CNJ Resolução 65/2008)
const STATE_ALIASES: Record<number, string> = {
  1:  'tjac',   // Acre
  2:  'tjal',   // Alagoas
  3:  'tjap',   // Amapá   ← vem antes de Amazonas
  4:  'tjam',   // Amazonas
  5:  'tjba',   // Bahia
  6:  'tjce',   // Ceará
  7:  'tjdft',  // Distrito Federal e Territórios
  8:  'tjes',   // Espírito Santo
  9:  'tjgo',   // Goiás
  10: 'tjma',   // Maranhão
  11: 'tjmt',   // Mato Grosso     ← vem antes de Mato Grosso do Sul
  12: 'tjms',   // Mato Grosso do Sul
  13: 'tjmg',   // Minas Gerais
  14: 'tjpa',   // Pará
  15: 'tjpb',   // Paraíba
  16: 'tjpr',   // Paraná          ← vem antes de Pernambuco
  17: 'tjpe',   // Pernambuco
  18: 'tjpi',   // Piauí
  19: 'tjrj',   // Rio de Janeiro
  20: 'tjrn',   // Rio Grande do Norte
  21: 'tjrs',   // Rio Grande do Sul ← vem antes de Rondônia
  22: 'tjro',   // Rondônia
  23: 'tjrr',   // Roraima
  24: 'tjsc',   // Santa Catarina
  25: 'tjsp',   // São Paulo       ← 'ã' < 'e', vem antes de Sergipe
  26: 'tjse',   // Sergipe
  27: 'tjto',   // Tocantins
};

const ELECTORAL_ALIASES: Record<number, string> = {
  1: 'tre-ac', 2: 'tre-al', 3: 'tre-am', 4: 'tre-ap', 5: 'tre-ba',
  6: 'tre-ce', 7: 'tre-dft', 8: 'tre-es', 9: 'tre-go', 10: 'tre-ma',
  11: 'tre-mg', 12: 'tre-ms', 13: 'tre-mt', 14: 'tre-pa', 15: 'tre-pb',
  16: 'tre-pe', 17: 'tre-pi', 18: 'tre-pr', 19: 'tre-rj', 20: 'tre-rn',
  21: 'tre-ro', 22: 'tre-rr', 23: 'tre-rs', 24: 'tre-sc', 25: 'tre-se',
  26: 'tre-sp', 27: 'tre-to',
};

const MILITARY_STATE_ALIASES: Record<number, string> = {
  13: 'tjmmg', // Minas Gerais (agora código 13)
  21: 'tjmrs', // Rio Grande do Sul (agora código 21)
  25: 'tjmsp', // São Paulo (agora código 25)
};

export function getTribunalAlias(processCode: string): string | null {
  const digits = processCode.replace(/\D/g, '');
  if (digits.length !== 20) return null;

  const j = digits[13];
  const tt = parseInt(digits.substring(14, 16), 10);

  switch (j) {
    case '8': return STATE_ALIASES[tt] ? `api_publica_${STATE_ALIASES[tt]}` : null;
    case '4': return tt >= 1 && tt <= 6 ? `api_publica_trf${tt}` : null;
    case '5': return tt === 0 ? 'api_publica_tst' : (tt >= 1 && tt <= 24 ? `api_publica_trt${tt}` : null);
    case '6': return tt === 0 ? 'api_publica_tse' : (ELECTORAL_ALIASES[tt] ? `api_publica_${ELECTORAL_ALIASES[tt]}` : null);
    case '3': return 'api_publica_stj';
    case '7': return 'api_publica_stm';
    case '9': return MILITARY_STATE_ALIASES[tt] ? `api_publica_${MILITARY_STATE_ALIASES[tt]}` : null;
    default:  return null;
  }
}

export function getTribunalNome(alias: string): string {
  const a = alias.replace('api_publica_', '').toUpperCase();
  const nomes: Record<string, string> = {
    TJSP: 'TJSP — São Paulo', TJRJ: 'TJRJ — Rio de Janeiro', TJMG: 'TJMG — Minas Gerais',
    TJRS: 'TJRS — Rio Grande do Sul', TJPR: 'TJPR — Paraná', TJSC: 'TJSC — Santa Catarina',
    TJBA: 'TJBA — Bahia', TJPE: 'TJPE — Pernambuco', TJCE: 'TJCE — Ceará',
    TJGO: 'TJGO — Goiás', TJDFT: 'TJDFT — DF e Territórios', TJAM: 'TJAM — Amazonas',
    TJMT: 'TJMT — Mato Grosso', TJMS: 'TJMS — Mato Grosso do Sul', TJPA: 'TJPA — Pará',
    TJES: 'TJES — Espírito Santo', TJAL: 'TJAL — Alagoas', TJPB: 'TJPB — Paraíba',
    TJRN: 'TJRN — Rio Grande do Norte', TJPI: 'TJPI — Piauí', TJSE: 'TJSE — Sergipe',
    TJMA: 'TJMA — Maranhão', TJAC: 'TJAC — Acre', TJRO: 'TJRO — Rondônia',
    TJAP: 'TJAP — Amapá', TJRR: 'TJRR — Roraima', TJTO: 'TJTO — Tocantins',
    TRF1: 'TRF1 — 1ª Região', TRF2: 'TRF2 — 2ª Região', TRF3: 'TRF3 — 3ª Região',
    TRF4: 'TRF4 — 4ª Região', TRF5: 'TRF5 — 5ª Região', TRF6: 'TRF6 — 6ª Região',
    STJ: 'STJ — Superior Tribunal de Justiça', STM: 'STM — Superior Tribunal Militar',
    TST: 'TST — Tribunal Superior do Trabalho', TSE: 'TSE — Tribunal Superior Eleitoral',
  };
  for (const [key, val] of Object.entries(nomes)) {
    if (a.includes(key)) return val;
  }
  return a;
}

// ── API Call ───────────────────────────────────────────────────────────────────

export async function fetchDatajudMovimentos(processCode: string): Promise<DatajudResult> {
  const alias = getTribunalAlias(processCode);
  if (!alias) {
    return { processo: null, tribunal: null, error: 'Número de processo inválido ou tribunal não reconhecido. Verifique se está no formato CNJ (ex: 0001234-55.2023.8.26.0001).' };
  }

  const digits = processCode.replace(/\D/g, '');

  // Lê a chave configurada pelo admin (com fallback para a chave padrão)
  const keyConfig = await settingsService.getDatajudKeyConfig().catch(
    () => ({ key: settingsService.DATAJUD_DEFAULT_KEY, invalid: false, invalid_since: null })
  );
  const apiKey = keyConfig.key || settingsService.DATAJUD_DEFAULT_KEY;

  try {
    // Chamada via Edge Function proxy (server-side, sem CORS)
    // A chave é passada no body para que a Edge Function a use
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s

    let response: Response;
    try {
      response = await fetch(DATAJUD_PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ alias, numeroProcesso: digits, datajudApiKey: apiKey }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // Chave inválida → sinaliza no settings para o dashboard exibir alerta
      if (response.status === 401 || response.status === 403) {
        settingsService.markDatajudKeyInvalid().catch(() => {});
        return { processo: null, tribunal: alias, error: 'Chave de API do DataJud (CNJ) inválida ou expirada. Atualize-a em Configurações → DJEN.' };
      }
      const body = await response.json().catch(() => ({}));
      if (response.status === 404) {
        return { processo: null, tribunal: alias, error: 'Processo não encontrado no DataJud. Pode ainda não ter sido indexado pelo CNJ.' };
      }
      return { processo: null, tribunal: alias, error: body.error ?? `Erro ${response.status} ao consultar o DataJud.` };
    }

    // Sucesso — se havia flag de chave inválida, limpa
    if (keyConfig.invalid) {
      settingsService.clearDatajudKeyInvalid().catch(() => {});
    }

    const data = await response.json();
    const hit = data?.hits?.hits?.[0];

    if (!hit) {
      return { processo: null, tribunal: alias, error: 'Processo não encontrado no DataJud para este tribunal.' };
    }

    const src: DatajudProcesso = hit._source;
    const sorted = [...(src.movimentos ?? [])].sort(
      (a, b) => new Date(b.dataHora).getTime() - new Date(a.dataHora).getTime()
    );

    return { processo: { ...src, movimentos: sorted }, tribunal: alias };

  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { processo: null, tribunal: alias, error: 'Tempo limite de 10s excedido ao consultar o DataJud. Tente novamente.' };
    }
    return { processo: null, tribunal: alias, error: `Erro inesperado: ${String(err)}` };
  }
}

// ── Categorização de movimentos ───────────────────────────────────────────────
// Códigos TPU: https://www.cnj.jus.br/sgt/consulta_publica_classes.php

export type MovimentoCategoria = 'decisao' | 'sentenca' | 'despacho' | 'audiencia' | 'citacao' | 'recurso' | 'arquivamento' | 'outro';

export function categorizarMovimento(codigo: number, nome: string): MovimentoCategoria {
  const n = nome.toLowerCase();
  if ([55, 196, 848, 849, 861, 862].includes(codigo) || n.includes('sentença') || n.includes('sentenca')) return 'sentenca';
  if ([11, 22, 471, 472].includes(codigo) || n.includes('decisão') || n.includes('decisao') || n.includes('acórdão')) return 'decisao';
  if ([132, 7, 9].includes(codigo) || n.includes('despacho')) return 'despacho';
  if ([971, 972, 974].includes(codigo) || n.includes('audiência') || n.includes('audiencia') || n.includes('sessão')) return 'audiencia';
  if ([65, 159, 1259].includes(codigo) || n.includes('citação') || n.includes('citacao') || n.includes('intimação') || n.includes('intimacao')) return 'citacao';
  if ([197, 237, 238, 239, 240].includes(codigo) || n.includes('recurso') || n.includes('apelação') || n.includes('agravo')) return 'recurso';
  if ([246, 248, 22].includes(codigo) || n.includes('arquiv') || n.includes('extinção') || n.includes('extincao')) return 'arquivamento';
  return 'outro';
}

export function isSuggestaoPrazo(categoria: MovimentoCategoria): boolean {
  return ['decisao', 'sentenca', 'citacao', 'audiencia'].includes(categoria);
}
