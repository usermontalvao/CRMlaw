import { djenService } from './djen.service';
import type { DjenComunicacao } from '../types/djen.types';

export interface TimelineEvent {
  id: string;
  date: string;
  type: 'intimacao' | 'citacao' | 'despacho' | 'sentenca' | 'decisao' | 'outro';
  title: string;
  description: string;
  orgao: string;
  hash?: string;
  rawData?: DjenComunicacao;
  aiAnalysis?: {
    summary: string;
    urgency: 'baixa' | 'media' | 'alta' | 'critica';
    actionRequired: boolean;
    keyPoints: string[];
  };
}

class ProcessTimelineService {
  private groqApiKey: string | null = null;

  constructor() {
    this.groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
  }

  /**
   * Busca todas as intimações/comunicações de um processo no DJEN
   */
  async fetchProcessTimeline(processCode: string): Promise<TimelineEvent[]> {
    try {
      const processNumber = processCode.replace(/\D/g, '');
      
      if (processNumber.length !== 20) {
        throw new Error('Número de processo inválido');
      }

      // Extrair ano do processo
      const yearMatch = processCode.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;

      const searchParams: any = {
        numeroProcesso: processNumber,
        itensPorPagina: 100,
      };

      if (year) {
        searchParams.dataDisponibilizacaoInicio = `${year}-01-01`;
      }

      const response = await djenService.consultarComunicacoes(searchParams);

      if (!response.items || response.items.length === 0) {
        return [];
      }

      // Converter para eventos de timeline
      const events: TimelineEvent[] = response.items.map((item, index) => ({
        id: item.hash || `event-${index}`,
        date: item.datadisponibilizacao || '',
        type: this.mapTipoDocumento(item.tipoDocumento),
        title: this.extractTitle(item),
        description: item.texto || '',
        orgao: item.nomeOrgao || '',
        hash: item.hash,
        rawData: item,
      }));

      // Ordenar por data (mais recente primeiro)
      events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return events;
    } catch (error: any) {
      console.error('Erro ao buscar timeline do processo:', error);
      throw error;
    }
  }

  /**
   * Analisa um evento da timeline usando IA (Groq)
   */
  async analyzeTimelineEvent(event: TimelineEvent): Promise<TimelineEvent['aiAnalysis']> {
    if (!this.groqApiKey) {
      return undefined;
    }

    try {
      const prompt = `Analise esta publicação do Diário de Justiça e extraia informações importantes.

PUBLICAÇÃO:
Data: ${event.date}
Órgão: ${event.orgao}
Tipo: ${event.type}
Conteúdo: ${event.description.substring(0, 2000)}

Responda APENAS com JSON válido no formato:
{
  "summary": "Resumo em 1-2 frases do que aconteceu no processo",
  "urgency": "baixa|media|alta|critica",
  "actionRequired": true ou false,
  "keyPoints": ["ponto 1", "ponto 2"]
}

Regras:
- Se mencionar prazo, urgência deve ser "alta" ou "critica"
- Se for citação ou intimação para manifestação, actionRequired = true
- Se for apenas movimentação de rotina, urgência = "baixa"
- Seja conciso no resumo`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: 'Você é um assistente jurídico especializado em análise de publicações do Diário de Justiça. Responda sempre em JSON válido.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Extrair JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'Análise não disponível',
          urgency: parsed.urgency || 'baixa',
          actionRequired: parsed.actionRequired || false,
          keyPoints: parsed.keyPoints || [],
        };
      }

      return undefined;
    } catch (error) {
      console.error('Erro ao analisar evento:', error);
      return undefined;
    }
  }

  /**
   * Busca timeline e analisa todos os eventos com IA
   */
  async fetchAndAnalyzeTimeline(
    processCode: string, 
    onProgress?: (current: number, total: number) => void
  ): Promise<TimelineEvent[]> {
    const events = await this.fetchProcessTimeline(processCode);
    
    if (!this.groqApiKey || events.length === 0) {
      return events;
    }

    // Analisar apenas os 10 eventos mais recentes para não sobrecarregar
    const eventsToAnalyze = events.slice(0, 10);
    
    for (let i = 0; i < eventsToAnalyze.length; i++) {
      if (onProgress) {
        onProgress(i + 1, eventsToAnalyze.length);
      }
      
      const analysis = await this.analyzeTimelineEvent(eventsToAnalyze[i]);
      if (analysis) {
        eventsToAnalyze[i].aiAnalysis = analysis;
      }
      
      // Aguardar 500ms entre requisições
      if (i < eventsToAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Mesclar eventos analisados com o resto
    return [...eventsToAnalyze, ...events.slice(10)];
  }

  /**
   * Mapeia tipo de documento do DJEN para tipo de evento
   */
  private mapTipoDocumento(tipo?: string): TimelineEvent['type'] {
    if (!tipo) return 'outro';
    
    const tipoLower = tipo.toLowerCase();
    
    if (tipoLower.includes('intimação') || tipoLower.includes('intimacao')) return 'intimacao';
    if (tipoLower.includes('citação') || tipoLower.includes('citacao')) return 'citacao';
    if (tipoLower.includes('despacho')) return 'despacho';
    if (tipoLower.includes('sentença') || tipoLower.includes('sentenca')) return 'sentenca';
    if (tipoLower.includes('decisão') || tipoLower.includes('decisao')) return 'decisao';
    
    return 'outro';
  }

  /**
   * Extrai título do evento baseado no conteúdo
   */
  private extractTitle(item: DjenComunicacao): string {
    // Tentar extrair do tipo de documento
    if (item.tipoDocumento) {
      return item.tipoDocumento;
    }
    
    // Tentar extrair do tipo de comunicação
    if (item.tipoComunicacao) {
      return item.tipoComunicacao;
    }
    
    // Extrair do início do texto
    if (item.texto) {
      const firstLine = item.texto.split('\n')[0].trim();
      if (firstLine.length > 100) {
        return firstLine.substring(0, 100) + '...';
      }
      return firstLine || 'Publicação';
    }
    
    return 'Publicação no Diário';
  }
}

export const processTimelineService = new ProcessTimelineService();
