import type {
  DjenConsultaParams,
  DjenConsultaResponse,
  DjenTribunal,
} from '../types/djen.types';
import { supabase } from '../config/supabase';

/**
 * A chamada direta do navegador ao DJEN falha por dois motivos independentes:
 *
 * 1. CORS: `comunicaapi.pje.jus.br` não envia `Access-Control-Allow-Origin`,
 *    então o preflight é bloqueado.
 * 2. Geo-block: o CloudFront do DJEN responde 403 ("blocked access from your
 *    country") para qualquer IP fora do Brasil — inclusive a máquina do usuário
 *    quando ele está no exterior.
 *
 * A Edge Function `djen-proxy` resolve os dois, mas só quando executa no Brasil:
 * o Supabase roda a função na região mais próxima de quem chama, então uma
 * chamada feita do exterior sairia com IP estrangeiro e tomaria 403 igual. O
 * header `x-region` força a execução em sa-east-1 (São Paulo), garantindo egress
 * brasileiro independentemente de onde o usuário esteja.
 */
const DJEN_PROXY_REGION = 'sa-east-1';

class DjenService {
  private baseUrl = 'https://comunicaapi.pje.jus.br/api/v1';

  private async invokeProxy<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke('djen-proxy', {
      headers: { 'x-region': DJEN_PROXY_REGION },
      body: { endpoint, params },
    });

    if (error) {
      throw new Error(`Edge Function error: ${error.message}`);
    }

    if (data?.error) {
      // O proxy repassa o status do DJEN dentro da mensagem; 429 tem tratamento
      // próprio porque o chamador espaça as requisições justamente para evitá-lo.
      if (String(data.error).includes('429')) {
        throw new Error('Taxa de requisições excedida. Aguarde 1 minuto antes de tentar novamente.');
      }
      throw new Error(data.error);
    }

    return data as T;
  }

  /**
   * Consulta comunicações no DJEN (uma página)
   * Atenção: as seguintes consultas são limitadas em 10000 resultados:
   * - pesquisas com campos textuais ou OAB
   * - pesquisas com 5 ou menos itensPorPagina
   * - pesquisas com data de início e data de fim diferentes
   * - pesquisas com número de processo
   */
  async consultarComunicacoes(params: DjenConsultaParams): Promise<DjenConsultaResponse> {
    try {
      return await this.invokeProxy<DjenConsultaResponse>('/comunicacao', {
        numeroOab: params.numeroOab,
        ufOab: params.ufOab,
        nomeAdvogado: params.nomeAdvogado,
        nomeParte: params.nomeParte,
        numeroProcesso: params.numeroProcesso,
        dataDisponibilizacaoInicio: params.dataDisponibilizacaoInicio,
        dataDisponibilizacaoFim: params.dataDisponibilizacaoFim,
        siglaTribunal: params.siglaTribunal,
        numeroComunicacao: params.numeroComunicacao,
        pagina: params.pagina,
        itensPorPagina: params.itensPorPagina,
        orgaoId: params.orgaoId,
        meio: params.meio,
      });
    } catch (error: any) {
      console.error('Erro ao consultar comunicações DJEN:', error);
      throw error;
    }
  }

  /**
   * Consulta todas as páginas de comunicações automaticamente
   * Retorna todas as comunicações encontradas
   */
  async consultarTodasComunicacoes(
    params: DjenConsultaParams,
    onProgress?: (pagina: number, total: number) => void,
  ): Promise<DjenConsultaResponse> {
    const allItems: any[] = [];
    let currentPage = params.pagina || 1;
    let totalCount = 0;

    try {
      // Primeira página
      const firstResponse = await this.consultarComunicacoes({
        ...params,
        pagina: currentPage,
        itensPorPagina: params.itensPorPagina || 100,
      });

      allItems.push(...(firstResponse.items || []));
      totalCount = firstResponse.count || 0;

      if (onProgress) {
        onProgress(currentPage, Math.ceil(totalCount / (params.itensPorPagina || 100)));
      }

      // Se há mais páginas, busca todas
      const itemsPerPage = params.itensPorPagina || 100;
      const totalPages = Math.ceil(totalCount / itemsPerPage);

      for (let page = currentPage + 1; page <= totalPages; page++) {
        // Aguarda 500ms entre requisições para evitar rate limit
        await new Promise((resolve) => setTimeout(resolve, 500));

        const pageResponse = await this.consultarComunicacoes({
          ...params,
          pagina: page,
          itensPorPagina: itemsPerPage,
        });

        allItems.push(...(pageResponse.items || []));

        if (onProgress) {
          onProgress(page, totalPages);
        }
      }

      return {
        status: firstResponse.status,
        message: firstResponse.message,
        count: totalCount,
        items: allItems,
      };
    } catch (error: any) {
      console.error('Erro ao consultar todas as comunicações:', error);
      throw error;
    }
  }

  /**
   * Lista tribunais disponíveis
   */
  async listarTribunais(): Promise<DjenTribunal[]> {
    try {
      return await this.invokeProxy<DjenTribunal[]>('/comunicacao/tribunal');
    } catch (error: any) {
      console.error('Erro ao listar tribunais:', error);
      throw error;
    }
  }

  /**
   * Gera URL para certidão de uma comunicação.
   * Continua apontando direto para o DJEN: é um link aberto pelo usuário numa
   * nova aba (navegação, não fetch), então não sofre CORS. Ainda assim depende
   * do geo-block — de fora do Brasil o próprio DJEN devolve 403 na aba.
   */
  getCertidaoUrl(hash: string): string {
    return `${this.baseUrl}/comunicacao/${hash}/certidao`;
  }

  /**
   * Formata data para o formato esperado pela API (yyyy-mm-dd)
   */
  formatarDataParaApi(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getDataHoje(): string {
    const hoje = new Date();
    return hoje.toISOString().split('T')[0];
  }

  getDataDiasAtras(dias: number): string {
    const data = new Date();
    data.setDate(data.getDate() - dias);
    return data.toISOString().split('T')[0];
  }

  /**
   * Busca comunicações para múltiplos números de processo
   * Faz uma requisição por processo (com delay para evitar rate limit)
   */
  async consultarPorProcessos(
    processNumbers: string[],
    params: Omit<DjenConsultaParams, 'numeroProcesso'>,
    onProgress?: (current: number, total: number) => void,
  ): Promise<DjenConsultaResponse> {
    const allItems: any[] = [];
    let totalCount = 0;

    for (let i = 0; i < processNumbers.length; i++) {
      try {
        // Aguarda 600ms entre requisições para evitar rate limit
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }

        const response = await this.consultarTodasComunicacoes({
          ...params,
          numeroProcesso: processNumbers[i],
        });

        allItems.push(...(response.items || []));
        totalCount += response.count || 0;

        if (onProgress) {
          onProgress(i + 1, processNumbers.length);
        }
      } catch (error) {
        console.error(`Erro ao buscar processo ${processNumbers[i]}:`, error);
        // Continua com os próximos processos mesmo se um falhar
      }
    }

    return {
      status: 'success',
      message: `Consultados ${processNumbers.length} processos`,
      count: totalCount,
      items: allItems,
    };
  }
}

export const djenService = new DjenService();
