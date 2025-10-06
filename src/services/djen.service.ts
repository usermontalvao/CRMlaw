import type {
  DjenConsultaParams,
  DjenConsultaResponse,
  DjenTribunal,
} from '../types/djen.types';

class DjenService {
  private baseUrl = 'https://comunicaapi.pje.jus.br/api/v1';

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
      const queryParams = new URLSearchParams();

      if (params.numeroOab) queryParams.append('numeroOab', params.numeroOab);
      if (params.ufOab) queryParams.append('ufOab', params.ufOab);
      if (params.nomeAdvogado) queryParams.append('nomeAdvogado', params.nomeAdvogado);
      if (params.nomeParte) queryParams.append('nomeParte', params.nomeParte);
      if (params.numeroProcesso) queryParams.append('numeroProcesso', params.numeroProcesso);
      if (params.dataDisponibilizacaoInicio)
        queryParams.append('dataDisponibilizacaoInicio', params.dataDisponibilizacaoInicio);
      if (params.dataDisponibilizacaoFim)
        queryParams.append('dataDisponibilizacaoFim', params.dataDisponibilizacaoFim);
      if (params.siglaTribunal) queryParams.append('siglaTribunal', params.siglaTribunal);
      if (params.numeroComunicacao)
        queryParams.append('numeroComunicacao', params.numeroComunicacao.toString());
      if (params.pagina) queryParams.append('pagina', params.pagina.toString());
      if (params.itensPorPagina)
        queryParams.append('itensPorPagina', params.itensPorPagina.toString());
      if (params.orgaoId) queryParams.append('orgaoId', params.orgaoId.toString());
      if (params.meio) queryParams.append('meio', params.meio);

      const response = await fetch(`${this.baseUrl}/comunicacao?${queryParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 429) {
        throw new Error(
          'Taxa de requisições excedida. Aguarde 1 minuto antes de tentar novamente.',
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Erro ao consultar comunicações: ${response.status}`);
      }

      const data: DjenConsultaResponse = await response.json();
      return data;
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
      const response = await fetch(`${this.baseUrl}/comunicacao/tribunal`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Erro ao listar tribunais: ${response.status}`);
      }

      const data: DjenTribunal[] = await response.json();
      return data;
    } catch (error: any) {
      console.error('Erro ao listar tribunais:', error);
      throw error;
    }
  }

  /**
   * Gera URL para certidão de uma comunicação
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
