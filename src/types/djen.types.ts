// Tipos para integração com API do Diário de Justiça Eletrônico Nacional (DJEN)

export interface DjenAdvogado {
  id: number;
  nome: string;
  numero_oab: string;
  uf_oab: string;
  tipo_inscricao?: string;
  email?: string;
}

export interface DjenDestinatarioAdvogado {
  id: number;
  comunicacao_id: number;
  advogado_id: number;
  created_at: string;
  updated_at: string;
  advogado: DjenAdvogado;
}

export interface DjenDestinatario {
  nome: string;
  polo: string;
  cpf_cnpj?: string;
  comunicacao_id: number;
}

export interface DjenComunicacao {
  id: number;
  data_disponibilizacao: string;
  siglaTribunal: string;
  tipoComunicacao: string;
  nomeOrgao: string;
  texto: string;
  numero_processo: string;
  meio: 'D' | 'E'; // D = Diário, E = Edital
  link: string;
  tipoDocumento: string;
  nomeClasse: string;
  codigoClasse: string;
  numeroComunicacao: number;
  ativo: boolean;
  hash: string;
  datadisponibilizacao: string;
  meiocompleto: string;
  numeroprocessocommascara: string;
  destinatarios: DjenDestinatario[];
  destinatarioadvogados: DjenDestinatarioAdvogado[];
}

export interface DjenConsultaResponse {
  status: string;
  message: string;
  count: number;
  items: DjenComunicacao[];
}

export interface DjenConsultaParams {
  numeroOab?: string;
  ufOab?: string;
  nomeAdvogado?: string;
  nomeParte?: string;
  numeroProcesso?: string;
  dataDisponibilizacaoInicio?: string; // yyyy-mm-dd
  dataDisponibilizacaoFim?: string; // yyyy-mm-dd
  siglaTribunal?: string;
  numeroComunicacao?: number;
  pagina?: number;
  itensPorPagina?: 5 | 100;
  orgaoId?: number;
  meio?: 'D' | 'E';
}

export interface DjenTribunal {
  id: number;
  nome: string;
  sigla: string;
  jurisdicao: string;
  endereco: string;
  telefone: string;
}

// Tipos para persistência local no Supabase
export interface DjenComunicacaoLocal {
  id: string;
  djen_id: number;
  hash: string;
  numero_comunicacao: number | null;
  numero_processo: string;
  numero_processo_mascara: string | null;
  codigo_classe: string | null;
  nome_classe: string | null;
  sigla_tribunal: string;
  nome_orgao: string | null;
  texto: string;
  tipo_comunicacao: string | null;
  tipo_documento: string | null;
  meio: 'D' | 'E';
  meio_completo: string | null;
  link: string | null;
  data_disponibilizacao: string;
  polo_ativo: string | null;
  polo_passivo: string | null;
  lida: boolean;
  lida_em: string | null;
  client_id: string | null;
  process_id: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  djen_destinatarios?: {
    id: string;
    nome: string;
    polo: string | null;
  }[];
  djen_advogados?: {
    id: string;
    nome: string;
    numero_oab: string;
    uf_oab: string;
  }[];
}

export interface CreateDjenComunicacaoDTO {
  djen_id: number;
  hash: string;
  numero_comunicacao: number | null;
  numero_processo: string;
  numero_processo_mascara: string | null;
  codigo_classe: string | null;
  nome_classe: string | null;
  sigla_tribunal: string;
  nome_orgao: string | null;
  texto: string;
  tipo_comunicacao: string | null;
  tipo_documento: string | null;
  meio: 'D' | 'E';
  meio_completo: string | null;
  link: string | null;
  data_disponibilizacao: string;
  polo_ativo?: string | null;
  polo_passivo?: string | null;
  client_id?: string | null;
  process_id?: string | null;
}

export interface UpdateDjenComunicacaoDTO {
  lida?: boolean;
  lida_em?: string | null;
  client_id?: string | null;
  process_id?: string | null;
}
