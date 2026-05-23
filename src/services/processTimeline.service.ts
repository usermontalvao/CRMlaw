import { djenService } from './djen.service';
import { processService } from './process.service';
import { supabase } from '../config/supabase';
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
  source?: 'djen' | 'datajud'; // origem do evento
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
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 horas - evita recarregamento frequente

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
   * Busca timeline do banco local (djen_comunicacoes) com análise IA já pronta
   * Usado quando o cron já sincronizou e analisou as intimações
   * Fallback para DJEN direto se não houver dados no banco
   */
  async fetchTimelineFromDatabase(processId: string, processCode: string): Promise<TimelineEvent[]> {
    try {
      // Buscar comunicações do banco local vinculadas ao processo
      // Inclui destinatários e advogados para exibir partes e órgão
      const { data: comunicacoes, error } = await supabase
        .from('djen_comunicacoes')
        .select(`*, djen_destinatarios (id, nome, polo), djen_advogados (id, nome, numero_oab, uf_oab)`)
        .eq('process_id', processId)
        .order('data_disponibilizacao', { ascending: false });

      if (error) {
        console.error('Erro ao buscar comunicações do banco:', error);
        // Fallback para DJEN direto
        return this.fetchProcessTimeline(processCode);
      }

      // Se não tem dados no banco, buscar do DJEN
      if (!comunicacoes || comunicacoes.length === 0) {
        console.log('📡 Sem dados no banco, buscando do DJEN...');
        return this.fetchProcessTimeline(processCode);
      }

      console.log(`📦 ${comunicacoes.length} comunicações encontradas no banco local`);

      // Converter para eventos de timeline
      const events: TimelineEvent[] = comunicacoes.map((item: any, index: number) => {
        // Mapear ai_analysis do banco para o formato esperado
        let aiAnalysis: TimelineEvent['aiAnalysis'] | undefined;
        if (item.ai_analysis) {
          const analysis = typeof item.ai_analysis === 'string' 
            ? JSON.parse(item.ai_analysis) 
            : item.ai_analysis;
          aiAnalysis = {
            summary: analysis.summary || '',
            urgency: analysis.urgency || 'baixa',
            actionRequired: analysis.action_required || false,
            keyPoints: analysis.key_points || [],
          };
        }

        return {
          id: item.id || `event-${index}`,
          date: item.data_disponibilizacao || '',
          type: this.mapTipoDocumento(item.tipo_documento || item.tipo_comunicacao, item.texto),
          title: item.tipo_documento || item.tipo_comunicacao || 'Publicação',
          description: item.texto || '',
          orgao: item.nome_orgao || '',
          grauRecursal: this.detectGrauRecursal(item.nome_orgao, item.texto),
          hash: item.numero_comunicacao?.toString(),
          rawData: {
            numeroComunicacao: item.numero_comunicacao,
            numeroProcesso: item.numero_processo,
            numeroProcessoMascara: item.numero_processo_mascara,
            siglaTribunal: item.sigla_tribunal,
            nomeOrgao: item.nome_orgao,
            nomeClasse: item.nome_classe,
            codigoClasse: item.codigo_classe,
            texto: item.texto,
            tipoComunicacao: item.tipo_comunicacao,
            tipoDocumento: item.tipo_documento,
            meio: item.meio,
            meiocompleto: item.meio_completo,
            link: item.link,
            datadisponibilizacao: item.data_disponibilizacao,
            // Partes do processo vindas do banco
            destinatarios: (item.djen_destinatarios ?? []).map((d: any) => ({
              nome: d.nome,
              polo: d.polo,
              comunicacao_id: item.numero_comunicacao,
            })),
            // Advogados
            destinatarioadvogados: (item.djen_advogados ?? []).map((a: any) => ({
              id: a.id,
              advogado: { nome: a.nome, numero_oab: a.numero_oab, uf_oab: a.uf_oab },
            })),
          } as unknown as DjenComunicacao,
          aiAnalysis,
        };
      });

      return events;
    } catch (error: any) {
      console.error('Erro ao buscar timeline do banco:', error);
      // Fallback para DJEN direto
      return this.fetchProcessTimeline(processCode);
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
- Se mencionar "bloqueio" de contas/aplicações/bens, urgência = "critica" e actionRequired = true
- Se for despacho com ordens executivas (penhora, arresto, sequestro), urgência = "critica"
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
   * Detecta o grau recursal exclusivamente pelo nome do órgão julgador.
   * NÃO usa o texto do documento — sentenças de 1ª instância citam STJ/STF
   * como jurisprudência, o que causaria falsos positivos.
   */
  private detectGrauRecursal(orgao?: string, _texto?: string): string | undefined {
    const o = (orgao || '').toLowerCase();
    if (!o) return undefined;

    // Instâncias superiores (matching exato antes de tj/trt genéricos)
    if (o.includes('supremo tribunal federal') || /\bstf\b/.test(o)) return 'STF';
    if (o.includes('superior tribunal de justiça') || /\bstj\b/.test(o)) return 'STJ';
    if (o.includes('tribunal superior do trabalho') || /\btst\b/.test(o)) return 'TST';
    if (o.includes('tribunal regional do trabalho') || /\btrt\b/.test(o)) return 'TRT';

    // Turma Recursal (JE 2ª instância)
    if (o.includes('turma recursal')) return 'Turma Recursal';

    // Tribunal de Justiça / 2º Grau
    if (o.includes('tribunal de justiça') || o.includes('câmara') || o.includes('2º grau') || o.includes('segundo grau')) return '2º Grau';

    // 1ª instância / JE
    if (o.includes('1º grau') || o.includes('primeiro grau') || o.includes('vara') || o.includes('juizado')) return '1º Grau';

    // Juizado Especial sem especificar grau → JE
    if (/\bje\b/.test(o)) return 'JE';

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
   * Prioriza o evento mais recente para determinar o status atual
   * Retorna sub-estágios específicos (citacao, conciliacao, contestacao, instrucao, recurso)
   */
  detectSuggestedStatus(events: TimelineEvent[]): ProcessStatus | null {
    if (events.length === 0) return null;

    // Ordenar eventos por data (mais recente primeiro)
    const sortedEvents = [...events].sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();
      return dateB - dateA;
    });

    // Analisar os eventos mais recentes (últimos 5) para determinar status atual
    const recentEvents = sortedEvents.slice(0, 5);
    const recentText = recentEvents.map(e => 
      (e.title + ' ' + e.description + ' ' + (e.aiAnalysis?.summary || '')).toLowerCase()
    ).join(' ');

    // Verificar tipos de eventos recentes primeiro
    const recentTypes = recentEvents.map(e => e.type);

    // Arquivado - apenas se explicitamente mencionado nos eventos recentes
    if (recentText.includes('arquivamento definitivo') || 
        recentText.includes('autos arquivados') ||
        recentText.includes('baixa definitiva') ||
        (recentText.includes('arquivado') && recentText.includes('transitado'))) {
      return 'arquivado';
    }

    // Cumprimento de sentença / Execução
    if (recentText.includes('cumprimento de sentença') || 
        recentText.includes('fase de cumprimento') ||
        recentText.includes('liquidação de sentença') ||
        (recentText.includes('execução') && !recentText.includes('recurso'))) {
      return 'cumprimento';
    }

    // Recurso - PRIORIDADE ALTA (antes de instrução)
    // Incluir termos específicos de recursos e julgamentos em tribunais superiores
    if (recentTypes.includes('recurso') ||
        recentText.includes('recurso inominado') ||
        recentText.includes('recurso especial') ||
        recentText.includes('recurso extraordinário') ||
        recentText.includes('recurso ordinário') ||
        recentText.includes('apelação') ||
        recentText.includes('agravo') ||
        recentText.includes('embargos de declaração') ||
        recentText.includes('sessão de julgamento') ||
        recentText.includes('pauta de julgamento') ||
        recentText.includes('turma recursal') ||
        recentText.includes('tribunal') ||
        (recentText.includes('recurso') && !recentText.includes('sem recurso'))) {
      return 'recurso';
    }

    // Sentença proferida
    if (recentTypes.includes('sentenca') ||
        recentText.includes('sentença proferida') ||
        recentText.includes('julgo procedente') || 
        recentText.includes('julgo improcedente') ||
        recentText.includes('julgou procedente') ||
        recentText.includes('julgou improcedente')) {
      return 'sentenca';
    }

    // Instrução (audiência de instrução, produção de provas)
    // Apenas se NÃO for relacionado a recurso
    if ((recentText.includes('audiência de instrução') ||
        recentText.includes('audiencia de instrucao') ||
        recentText.includes('instrução e julgamento') ||
        recentText.includes('produção de provas') ||
        recentText.includes('oitiva de testemunhas') ||
        recentText.includes('perícia')) &&
        !recentText.includes('recurso') &&
        !recentText.includes('tribunal')) {
      return 'instrucao';
    }

    // Conciliação (audiência de conciliação designada ou realizada)
    // Prioridade sobre contestação, pois a audiência geralmente vem antes ou define a fase atual
    if (recentText.includes('audiência de conciliação') ||
        recentText.includes('audiencia de conciliacao') ||
        recentText.includes('conciliação virtual') ||
        recentText.includes('conciliação designada') ||
        recentText.includes('pauta de conciliação')) {
      return 'conciliacao';
    }

    // Contestação
    if (recentText.includes('contestação') || 
        recentText.includes('contestacao') ||
        recentText.includes('defesa apresentada') ||
        recentText.includes('juntada de contestação') ||
        recentText.includes('réu contestou')) {
      return 'contestacao';
    }

    // Citação
    if (recentTypes.includes('citacao') ||
        recentText.includes('citação') || 
        recentText.includes('citacao') ||
        recentText.includes('citado') ||
        recentText.includes('cite-se')) {
      return 'citacao';
    }

    // Em andamento genérico (intimação, decisão, despacho sem fase específica)
    if (recentTypes.includes('intimacao') ||
        recentTypes.includes('decisao') ||
        recentTypes.includes('despacho') ||
        recentText.includes('intimação') || recentText.includes('intimacao') ||
        recentText.includes('decisão') || recentText.includes('despacho') ||
        recentText.includes('prazo') || recentText.includes('manifestação') ||
        recentText.includes('inversão') || recentText.includes('deferiu') ||
        recentText.includes('indeferiu')) {
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

      // Se o status sugerido for diferente do atual, atualiza
      // A análise da IA/timeline deve prevalecer para corrigir status incorretos
      if (suggestedStatus !== currentProcess.status) {
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

  // ─── Comarca extraction ──────────────────────────────────────────────────────
  // Palavras que sinalizam fim do nome da cidade (logradouros, keywords jurídicos)
  private readonly COMARCA_STOP = /^(Avenida|Av\.|Rua|Praça|Alameda|Al\.|CEP|Processo:|Classe:|AUTOR|RÉU|Despacho|Sentença|Intimação|Poder|Juizado|\d{5})$/i;

  /**
   * Extrai nome da vara/comarca de um texto livre (nome_orgao ou texto do movimento).
   * Para antes de logradouros para não incluir endereço.
   */
  extractComarcaFromText(text: string): string | null {
    if (!text) return null;

    // 1. "Juizado Especial/Criminal … da Comarca de CITY"
    const jMatch = text.match(
      /(Juizado\s+(?:Especial|Criminal|da\s+Fazenda)[^,\n]*?da\s+Comarca\s+de\s+([\wÀ-ú]+(?:\s+[\wÀ-ú]+){0,3}))/i
    );
    if (jMatch) {
      const city = jMatch[2].trim().split(/\s+/).filter(w => !this.COMARCA_STOP.test(w)).join(' ');
      if (city) return `Juizado Especial Cível - ${city}`;
    }

    // 2. "Nª Vara XXXX da Comarca de CITY"
    const vMatch = text.match(
      /(\d+[ªa°]?\s+Vara\s+[^,\n]*?da\s+Comarca\s+de\s+([\wÀ-ú]+(?:\s+[\wÀ-ú]+){0,3}))/i
    );
    if (vMatch) {
      const city = vMatch[2].trim().split(/\s+/).filter(w => !this.COMARCA_STOP.test(w)).join(' ');
      const vara = vMatch[1].split(/da\s+Comarca/i)[0].trim();
      if (city) return `${vara} - ${city}`;
    }

    // 3. Apenas "Comarca de CITY" — para na stop word
    const cMatch = text.match(/Comarca\s+de\s+([\wÀ-ú]+(?:\s+[\wÀ-ú]+){0,3})/i);
    if (cMatch) {
      const words = cMatch[1].trim().split(/\s+/);
      const clean: string[] = [];
      for (const w of words) {
        if (this.COMARCA_STOP.test(w)) break;
        clean.push(w);
      }
      if (clean.length) return clean.join(' ');
    }

    return null;
  }

  /**
   * Pós-sincronização DJEN: atualiza estágio e comarca dos processos afetados.
   * Chamado pelo CronEndpoint após salvar comunicações.
   * @param processIds IDs dos processos que receberam novas comunicações
   */
  async enrichProcessesAfterSync(
    processes: Array<{ id: string; process_code: string | null | undefined; court?: string | null }>
  ): Promise<{ stagesUpdated: number; comarcasUpdated: number }> {
    let stagesUpdated = 0;
    let comarcasUpdated = 0;

    console.log(`🔄 enrichProcessesAfterSync: processando ${processes.length} processos...`);

    for (const proc of processes) {
      try {
        const events = await this.fetchTimelineFromDatabase(proc.id, proc.process_code ?? '');
        if (events.length === 0) continue;

        // 1. Atualizar estágio
        const newStatus = await this.autoUpdateProcessStatus(proc.id, events);
        if (newStatus) stagesUpdated++;

        // 2. Atualizar comarca se ainda vazia
        if (!proc.court) {
          // Buscar nome_orgao das comunicações do processo
          const { data: comuns } = await supabase
            .from('djen_comunicacoes')
            .select('nome_orgao, texto')
            .eq('process_id', proc.id)
            .eq('ativo', true)
            .not('nome_orgao', 'is', null)
            .limit(5);

          const textBlob = (comuns ?? [])
            .map(c => `${c.nome_orgao || ''} ${c.texto?.slice(0, 500) || ''}`)
            .join(' ');

          const comarca = this.extractComarcaFromText(textBlob);
          if (comarca) {
            await processService.updateProcess(proc.id, { court: comarca });
            console.log(`📍 Comarca detectada para processo ${proc.process_code}: ${comarca}`);
            comarcasUpdated++;
          }
        }
      } catch (err) {
        console.error(`⚠️ enrichProcessesAfterSync: erro no processo ${proc.id}`, err);
      }
    }

    console.log(`✅ enrichProcessesAfterSync: ${stagesUpdated} estágios, ${comarcasUpdated} comarcas atualizados`);
    return { stagesUpdated, comarcasUpdated };
  }
}

export const processTimelineService = new ProcessTimelineService();
