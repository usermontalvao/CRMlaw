import { djenService } from './djen.service';
import { processService } from './process.service';
import type { DjenComunicacao } from '../types/djen.types';
import type { ProcessStatus } from '../types/process.types';

export interface TimelineEvent {
  id: string;
  date: string;
  type: 'intimacao' | 'citacao' | 'despacho' | 'sentenca' | 'decisao' | 'recurso' | 'outro';
  title: string;
  description: string;
  orgao: string;
  grauRecursal?: string;
  hash?: string;
  rawData?: DjenComunicacao;
  aiAnalysis?: {
    summary: string;
    urgency: 'baixa' | 'media' | 'alta' | 'critica';
    actionRequired: boolean;
    keyPoints: string[];
    tipoMovimentacao?: string;
  };
}

interface TimelineCache {
  events: TimelineEvent[];
  lastEventHash: string;
  timestamp: number;
  analyzedHashes: Set<string>; // Hashes de eventos já analisados
}

interface StoredTimelineCache {
  events: TimelineEvent[];
  lastEventHash: string;
  timestamp: number;
  analyzedHashes: string[]; // Array para serialização
}

class ProcessTimelineService {
  private groqApiKey: string | null = null;
  private cache: Map<string, TimelineCache> = new Map();
  private readonly CACHE_DURATION = 60 * 60 * 1000; // 1 hora - só atualiza quando há nova publicação

  constructor() {
    this.groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
    this.loadCacheFromStorage();
  }

  private loadCacheFromStorage() {
    try {
      const stored = localStorage.getItem('timeline-analysis-cache');
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.entries(parsed).forEach(([key, value]) => {
          const storedCache = value as StoredTimelineCache;
          this.cache.set(key, {
            ...storedCache,
            analyzedHashes: new Set(storedCache.analyzedHashes || []),
          });
        });
      }
    } catch (e) {
      console.warn('Erro ao carregar cache de timeline:', e);
    }
  }

  private saveCacheToStorage() {
    try {
      const obj: Record<string, StoredTimelineCache> = {};
      this.cache.forEach((value, key) => {
        obj[key] = {
          events: value.events,
          lastEventHash: value.lastEventHash,
          timestamp: value.timestamp,
          analyzedHashes: Array.from(value.analyzedHashes || []),
        };
      });
      localStorage.setItem('timeline-analysis-cache', JSON.stringify(obj));
    } catch (e) {
      console.warn('Erro ao salvar cache de timeline:', e);
    }
  }

  private getCachedAnalysis(processCode: string, currentEvents: TimelineEvent[]): TimelineEvent[] | null {
    const cached = this.cache.get(processCode);
    if (!cached) return null;

    // Verificar se o cache ainda é válido (10 minutos)
    if (Date.now() - cached.timestamp > this.CACHE_DURATION) {
      return null;
    }

    // Verificar se há novos eventos (comparar hash do primeiro evento)
    const currentFirstHash = currentEvents[0]?.hash || '';
    if (cached.lastEventHash !== currentFirstHash) {
      console.log('📝 Novos eventos detectados, re-analisando...');
      return null;
    }

    console.log('📦 Usando análise em cache');
    return cached.events;
  }

  private setCachedAnalysis(processCode: string, events: TimelineEvent[]) {
    const firstHash = events[0]?.hash || '';
    const existingCache = this.cache.get(processCode);
    
    // Preservar hashes já analisados e adicionar novos
    const analyzedHashes = new Set(existingCache?.analyzedHashes || []);
    events.forEach(e => {
      if (e.aiAnalysis && e.hash) {
        analyzedHashes.add(e.hash);
      }
    });
    
    this.cache.set(processCode, {
      events,
      lastEventHash: firstHash,
      timestamp: Date.now(),
      analyzedHashes,
    });
    this.saveCacheToStorage();
    console.log(`💾 Análise salva em cache (${analyzedHashes.size} eventos analisados)`);
  }

  /**
   * Retorna eventos do cache se existirem (sem chamar API)
   * Útil para exibir dados instantaneamente enquanto verifica atualizações
   */
  getCachedTimeline(processCode: string): TimelineEvent[] | null {
    const cached = this.cache.get(processCode);
    if (!cached) return null;
    
    // Retorna cache mesmo se expirado (para exibição imediata)
    console.log('📦 Timeline do cache local');
    return cached.events;
  }

  /**
   * Verifica se há novas publicações comparando hash do último evento
   * Retorna true se precisa atualizar
   */
  async checkForUpdates(processCode: string): Promise<boolean> {
    const cached = this.cache.get(processCode);
    if (!cached) return true; // Sem cache, precisa buscar
    
    try {
      const processNumber = processCode.replace(/\D/g, '');
      if (processNumber.length !== 20) return false;

      const yearMatch = processCode.match(/\d{7}-\d{2}\.(\d{4})\./);
      const year = yearMatch ? yearMatch[1] : null;

      const searchParams: any = {
        numeroProcesso: processNumber,
        itensPorPagina: 1, // Só precisa do primeiro para comparar hash
      };

      if (year) {
        searchParams.dataDisponibilizacaoInicio = `${year}-01-01`;
      }

      const response = await djenService.consultarComunicacoes(searchParams);
      
      if (!response.items || response.items.length === 0) {
        return false; // Sem novos dados
      }

      const latestHash = response.items[0]?.hash || '';
      const hasNewData = latestHash !== cached.lastEventHash;
      
      if (hasNewData) {
        console.log('🆕 Nova publicação detectada!');
      } else {
        console.log('✅ Timeline atualizada, sem novidades');
      }
      
      return hasNewData;
    } catch (error) {
      console.warn('Erro ao verificar atualizações:', error);
      return false;
    }
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
        type: this.mapTipoDocumento(item.tipoDocumento, item.texto),
        title: this.extractTitle(item),
        description: item.texto || '',
        orgao: item.nomeOrgao || '',
        grauRecursal: this.detectGrauRecursal(item.nomeOrgao, item.texto),
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
   * Usa cache para evitar re-análise desnecessária
   * OTIMIZADO: Só analisa eventos que ainda não foram analisados
   */
  async fetchAndAnalyzeTimeline(
    processCode: string, 
    onProgress?: (current: number, total: number) => void,
    forceRefresh: boolean = false
  ): Promise<TimelineEvent[]> {
    const events = await this.fetchProcessTimeline(processCode);
    
    if (events.length === 0) {
      return events;
    }

    // Buscar cache existente
    const existingCache = this.cache.get(processCode);
    const analyzedHashes = existingCache?.analyzedHashes || new Set<string>();
    const cachedEvents = existingCache?.events || [];
    
    // Criar mapa de análises existentes por hash
    const existingAnalyses = new Map<string, TimelineEvent['aiAnalysis']>();
    cachedEvents.forEach(e => {
      if (e.hash && e.aiAnalysis) {
        existingAnalyses.set(e.hash, e.aiAnalysis);
      }
    });

    // Restaurar análises existentes nos eventos atuais
    events.forEach(e => {
      if (e.hash && existingAnalyses.has(e.hash)) {
        e.aiAnalysis = existingAnalyses.get(e.hash);
      }
    });

    // Identificar eventos que precisam de análise (não analisados ainda)
    const eventsNeedingAnalysis = events.filter(e => 
      e.hash && !analyzedHashes.has(e.hash) && !e.aiAnalysis
    );

    // Se não há eventos novos para analisar, retornar com análises restauradas
    if (eventsNeedingAnalysis.length === 0 && !forceRefresh) {
      console.log(`📦 Usando cache completo (${analyzedHashes.size} eventos já analisados)`);
      if (onProgress) onProgress(1, 1);
      this.setCachedAnalysis(processCode, events);
      return events;
    }

    // Se forçando refresh, limpar análises
    if (forceRefresh) {
      events.forEach(e => { e.aiAnalysis = undefined; });
    }

    // Sem API key, retornar eventos sem análise
    if (!this.groqApiKey) {
      return events;
    }

    // Analisar apenas eventos que precisam (máximo 10)
    const toAnalyze = forceRefresh 
      ? events.slice(0, 10) 
      : eventsNeedingAnalysis.slice(0, 10);
    
    if (toAnalyze.length > 0) {
      console.log(`📝 Analisando ${toAnalyze.length} novos eventos (${analyzedHashes.size} já em cache)`);
    }
    
    for (let i = 0; i < toAnalyze.length; i++) {
      if (onProgress) {
        onProgress(i + 1, toAnalyze.length);
      }
      
      const analysis = await this.analyzeTimelineEvent(toAnalyze[i]);
      if (analysis) {
        toAnalyze[i].aiAnalysis = analysis;
      }
      
      // Aguardar 500ms entre requisições para evitar rate limit
      if (i < toAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Salvar no cache
    this.setCachedAnalysis(processCode, events);
    
    return events;
  }

  /**
   * Analisa apenas eventos novos
   */
  private async analyzeNewEvents(
    events: TimelineEvent[],
    onProgress?: (current: number, total: number) => void
  ): Promise<TimelineEvent[]> {
    if (!this.groqApiKey || events.length === 0) {
      return events;
    }

    const toAnalyze = events.slice(0, 5); // Máximo 5 novos eventos
    
    for (let i = 0; i < toAnalyze.length; i++) {
      if (onProgress) {
        onProgress(i + 1, toAnalyze.length);
      }
      
      const analysis = await this.analyzeTimelineEvent(toAnalyze[i]);
      if (analysis) {
        toAnalyze[i].aiAnalysis = analysis;
      }
      
      if (i < toAnalyze.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    return [...toAnalyze, ...events.slice(5)];
  }

  /**
   * Mapeia tipo de documento do DJEN para tipo de evento
   * Analisa o conteúdo do texto para classificação mais precisa
   * IMPORTANTE: Intimação tem prioridade quando há sinais claros (prazo, manifestação, etc.)
   */
  private mapTipoDocumento(tipo?: string, texto?: string): TimelineEvent['type'] {
    const tipoLower = (tipo || '').toLowerCase().trim();
    const textoLower = (texto || '').toLowerCase();
    
    // Analisar o texto completo para palavras-chave específicas
    // Usar primeiros 1500 chars para análise mais completa
    const textoAnalise = textoLower.substring(0, 1500);
    
    // INTIMAÇÃO - Verificar PRIMEIRO pois é o tipo mais comum e deve ter prioridade
    // quando há sinais claros de intimação (prazo, manifestação, etc.)
    const isIntimacao = 
        textoAnalise.includes('intimação') ||
        textoAnalise.includes('intime-se') ||
        textoAnalise.includes('fica intimado') ||
        textoAnalise.includes('intimando') ||
        textoAnalise.includes('prazo de') ||
        textoAnalise.includes('no prazo') ||
        textoAnalise.includes('manifestar') ||
        textoAnalise.includes('manifestação') ||
        textoAnalise.includes('comparecer') ||
        textoAnalise.includes('apresentar') ||
        textoAnalise.includes('cumprimento de sentença') ||
        textoAnalise.includes('fase de cumprimento') ||
        textoAnalise.includes('satisfação do crédito') ||
        textoAnalise.includes('arquivamento') ||
        tipoLower.includes('intimação') || tipoLower.includes('intimacao');
    
    if (isIntimacao) {
      return 'intimacao';
    }
    
    // SENTENÇA - Apenas quando é realmente a prolação da sentença
    // Não confundir com intimações sobre cumprimento de sentença
    const isSentenca = 
        (textoAnalise.includes('julgo procedente') || 
         textoAnalise.includes('julgo improcedente') ||
         textoAnalise.includes('julgo parcialmente procedente') ||
         textoAnalise.includes('extingo o processo') ||
         textoAnalise.includes('homologo o acordo') ||
         textoAnalise.includes('julgo extinto')) &&
        !textoAnalise.includes('cumprimento de sentença') &&
        !textoAnalise.includes('fase de cumprimento');
    
    if (isSentenca || tipoLower === 'sentença' || tipoLower === 'sentenca') {
      return 'sentenca';
    }
    
    // DECISÃO - Tutelas, liminares, decisões interlocutórias
    if (textoAnalise.includes('tutela de urgência') ||
        textoAnalise.includes('tutela antecipada') ||
        textoAnalise.includes('liminar') ||
        textoAnalise.includes('defiro o pedido') ||
        textoAnalise.includes('indefiro o pedido') ||
        textoAnalise.includes('passo a decidir') ||
        tipoLower === 'decisão' || tipoLower === 'decisao') {
      return 'decisao';
    }
    
    // CITAÇÃO
    if (textoAnalise.includes('citação') ||
        textoAnalise.includes('cite-se') ||
        textoAnalise.includes('fica citado') ||
        textoAnalise.includes('citando') ||
        tipoLower.includes('citação') || tipoLower.includes('citacao')) {
      return 'citacao';
    }
    
    // DESPACHO
    if (textoAnalise.includes('despacho') ||
        textoAnalise.includes('vistos etc') ||
        textoAnalise.includes('conclusos') ||
        textoAnalise.includes('determino') ||
        textoAnalise.includes('dê-se vista') ||
        tipoLower.includes('despacho')) {
      return 'despacho';
    }
    
    // RECURSO - Apenas termos específicos de recursos processuais
    if (textoAnalise.includes('apelação') ||
        textoAnalise.includes('agravo de instrumento') ||
        textoAnalise.includes('agravo interno') ||
        textoAnalise.includes('embargos de declaração') ||
        textoAnalise.includes('recurso especial') ||
        textoAnalise.includes('recurso extraordinário') ||
        textoAnalise.includes('recurso ordinário') ||
        tipoLower.includes('acórdão') || tipoLower.includes('acordao')) {
      return 'recurso';
    }
    
    // Se não identificou, retorna 'outro'
    return 'outro';
  }

  /**
   * Detecta o grau recursal baseado no órgão ou conteúdo
   */
  private detectGrauRecursal(orgao?: string, texto?: string): string | undefined {
    const combined = ((orgao || '') + ' ' + (texto || '')).toLowerCase();
    
    if (combined.includes('stf') || combined.includes('supremo tribunal federal')) return 'STF';
    if (combined.includes('stj') || combined.includes('superior tribunal de justiça')) return 'STJ';
    if (combined.includes('tst') || combined.includes('tribunal superior do trabalho')) return 'TST';
    if (combined.includes('trt') || combined.includes('tribunal regional do trabalho')) return 'TRT';
    if (combined.includes('tj') || combined.includes('tribunal de justiça') || combined.includes('2º grau') || combined.includes('segundo grau')) return '2º Grau';
    if (combined.includes('turma recursal')) return 'Turma Recursal';
    if (combined.includes('1º grau') || combined.includes('primeiro grau') || combined.includes('vara')) return '1º Grau';
    
    return undefined;
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

  /**
   * Detecta o status sugerido do processo baseado nos eventos da timeline
   */
  detectSuggestedStatus(events: TimelineEvent[]): ProcessStatus | null {
    if (events.length === 0) return null;

    // Analisar todos os eventos para detectar o estágio
    const allText = events.map(e => 
      (e.title + ' ' + e.description + ' ' + (e.aiAnalysis?.summary || '')).toLowerCase()
    ).join(' ');

    // Verificar do mais avançado para o menos avançado
    
    // Arquivado
    if (allText.includes('arquivamento') || allText.includes('arquivado') ||
        allText.includes('baixa definitiva') || allText.includes('autos arquivados')) {
      return 'arquivado';
    }

    // Cumprimento de sentença / Execução
    if (allText.includes('cumprimento de sentença') || allText.includes('execução') ||
        allText.includes('fase de cumprimento') || allText.includes('liquidação')) {
      return 'cumprimento';
    }

    // Sentença proferida
    if (allText.includes('sentença') || allText.includes('sentenca') ||
        allText.includes('julgo procedente') || allText.includes('julgo improcedente') ||
        allText.includes('julgamento') || events.some(e => e.type === 'sentenca')) {
      return 'sentenca';
    }

    // Em andamento (citação, contestação, instrução, audiência)
    if (allText.includes('citação') || allText.includes('citacao') ||
        allText.includes('contestação') || allText.includes('contestacao') ||
        allText.includes('audiência') || allText.includes('audiencia') ||
        allText.includes('instrução') || allText.includes('instrucao') ||
        allText.includes('intimação') || allText.includes('intimacao') ||
        allText.includes('prazo') || allText.includes('manifestação')) {
      return 'andamento';
    }

    // Distribuído (tem eventos mas nenhum dos acima)
    if (events.length > 0) {
      return 'distribuido';
    }

    return null;
  }

  /**
   * Atualiza o status do processo automaticamente baseado na timeline
   */
  async autoUpdateProcessStatus(processId: string, events: TimelineEvent[]): Promise<ProcessStatus | null> {
    const suggestedStatus = this.detectSuggestedStatus(events);
    
    if (!suggestedStatus) return null;

    try {
      // Buscar processo atual
      const currentProcess = await processService.getProcessById(processId);
      if (!currentProcess) return null;

      // Definir hierarquia de status (do menos avançado para o mais avançado)
      const statusHierarchy: ProcessStatus[] = [
        'nao_protocolado',
        'aguardando_confeccao', 
        'distribuido',
        'andamento',
        'sentenca',
        'cumprimento',
        'arquivado'
      ];

      const currentIndex = statusHierarchy.indexOf(currentProcess.status);
      const suggestedIndex = statusHierarchy.indexOf(suggestedStatus);

      // Só atualiza se o status sugerido for mais avançado que o atual
      if (suggestedIndex > currentIndex) {
        await processService.updateStatus(processId, suggestedStatus);
        console.log(`✅ Status do processo atualizado automaticamente: ${currentProcess.status} → ${suggestedStatus}`);
        return suggestedStatus;
      }

      return null;
    } catch (error) {
      console.error('Erro ao atualizar status do processo:', error);
      return null;
    }
  }
}

export const processTimelineService = new ProcessTimelineService();
