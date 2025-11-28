import OpenAI from 'openai';
import type { IntimationAnalysis, AIServiceConfig, DeadlineExtraction } from '../types/ai.types';
import { supabase } from '../config/supabase';

class AIService {
  private openai: OpenAI | null = null;
  private enabled: boolean = false;
  private useEdgeFunction: boolean = false; // TEMPORÁRIO: Desabilitado até implantar Edge Function
  private useGroq: boolean = true; // Usar Groq como provider principal
  private groqApiKey: string | null = null;

  constructor() {
    this.initialize();
  }

  /**
   * Calcula data final considerando apenas dias úteis (exclui sábados e domingos)
   * Nota: Não considera feriados (seria necessário API externa)
   */
  private addBusinessDays(startDate: Date, daysToAdd: number): Date {
    const result = new Date(startDate);
    let remainingDays = daysToAdd;

    while (remainingDays > 0) {
      result.setDate(result.getDate() + 1);
      
      // Verifica se é dia útil (segunda a sexta)
      const dayOfWeek = result.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0 = Domingo, 6 = Sábado
        remainingDays--;
      }
    }

    return result;
  }

  private initialize() {
    // Primeiro tenta Groq (mais barato e sem rate limit agressivo)
    this.groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
    
    if (this.groqApiKey) {
      this.useGroq = true;
      this.enabled = true;
      console.log('✅ Groq AI Service inicializado (provider principal)');
      return;
    }
    
    // Fallback para OpenAI
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.warn('⚠️ Nenhuma API Key de IA configurada. Funcionalidades de IA desabilitadas.');
      this.enabled = false;
      return;
    }

    try {
      this.openai = new OpenAI({
        apiKey,
        dangerouslyAllowBrowser: true, // Para uso no cliente
      });
      this.useGroq = false;
      this.enabled = true;
      console.log('✅ OpenAI AI Service inicializado (fallback)');
    } catch (error) {
      console.error('❌ Erro ao inicializar OpenAI:', error);
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled && (this.groqApiKey !== null || this.openai !== null);
  }

  /**
   * Chama a API do Groq
   */
  private async callGroqAPI(messages: any[], maxTokens: number = 1000): Promise<string> {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.groqApiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.3,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Groq API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  /**
   * Chama a OpenAI API através da Edge Function do Supabase (evita CORS)
   */
  private async callOpenAIViaEdgeFunction(messages: any[], model: string = 'gpt-4o-mini'): Promise<any> {
    const { data, error } = await supabase.functions.invoke('openai-proxy', {
      body: { messages, model },
    });

    if (error) {
      throw new Error(`Edge Function error: ${error.message}`);
    }

    return data;
  }

  /**
   * Analisa uma intimação do DJEN e extrai informações relevantes
   */
  async analyzeIntimation(
    texto: string,
    numeroProcesso: string,
    dataDisponibilizacao: string,
    tipoDocumento?: string,
    tipoComunicacao?: string
  ): Promise<IntimationAnalysis> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está habilitado. Configure VITE_OPENAI_API_KEY.');
    }

    try {
      const systemPrompt = `Você é um assistente jurídico especializado em análise de intimações judiciais brasileiras.
Analise a intimação fornecida e extraia as seguintes informações em formato JSON:

{
  "summary": "Resumo claro e objetivo em 2-3 frases",
  "deadline": {
    "days": número_de_dias_do_prazo_ou_null,
    "dueDate": null,
    "description": "descrição_do_prazo_ou_empty",
    "confidence": "baixa|media|alta"
  },
  "urgency": "baixa|media|alta|critica",
  "suggestedActions": ["ação 1", "ação 2", "ação 3"],
  "keyPoints": ["ponto 1", "ponto 2", "ponto 3"],
  "documentType": "tipo_de_documento_identificado"
}

Regras IMPORTANTES:
- Se não houver prazo explícito, deadline deve ser null
- NUNCA preencha o campo "dueDate" - deixe sempre como null (o sistema calculará considerando dias úteis)
- O campo "days" deve conter APENAS o número de dias mencionado no texto
- Prazos processuais no Brasil são contados em DIAS ÚTEIS (segunda a sexta), nunca em dias corridos
- Urgência: critica (liminar/tutela), alta (sentença/prazo curto ≤5 dias), media (intimação comum 10-15 dias), baixa (mera ciência/prazos longos)
- Ações devem ser práticas e específicas
- Pontos-chave devem ser os mais relevantes para o advogado
- Responda APENAS com o JSON, sem texto adicional`;

      const userPrompt = `Processo: ${numeroProcesso}
Tipo de Documento: ${tipoDocumento || 'Não especificado'}
Tipo de Comunicação: ${tipoComunicacao || 'Não especificado'}

Texto da Intimação:
${texto}`;

      let content: string | null;

      if (this.useGroq && this.groqApiKey) {
        // Usa Groq API (mais barato e sem rate limit agressivo)
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 1000);
      } else if (this.useEdgeFunction) {
        // Usa Edge Function para evitar CORS
        const response = await this.callOpenAIViaEdgeFunction([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 'gpt-4o-mini');
        content = response.choices[0].message.content;
      } else {
        // Usa OpenAI diretamente (pode ter problema de CORS)
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1000,
          response_format: { type: 'json_object' },
        });
        content = response.choices[0].message.content;
      }
      if (!content) {
        throw new Error('Resposta vazia da API');
      }
      
      // Extrair JSON da resposta (Groq pode retornar texto extra)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const analysis: IntimationAnalysis = JSON.parse(content);
      
      // Calcular data de vencimento usando dias úteis A PARTIR DA DATA DE DISPONIBILIZAÇÃO
      if (analysis.deadline && analysis.deadline.days) {
        const startDate = new Date(dataDisponibilizacao);
        const dueDate = this.addBusinessDays(startDate, analysis.deadline.days);
        analysis.deadline.dueDate = dueDate.toISOString();
      }

      return analysis;
    } catch (error: any) {
      console.error('Erro ao analisar intimação com IA:', error);
      throw new Error(`Erro na análise: ${error.message}`);
    }
  }

  /**
   * Extrai prazo de um texto de intimação
   */
  async extractDeadline(texto: string): Promise<DeadlineExtraction | null> {
    if (!this.isEnabled()) {
      return null;
    }

    try {
      const systemPrompt = `Você é um especialista em extração de prazos processuais brasileiros.
Analise o texto e identifique se há algum prazo. Responda APENAS com JSON:

{
  "days": número_de_dias_ou_null,
  "dueDate": "data_limite_ISO_ou_null",
  "description": "descrição_do_prazo",
  "confidence": "baixa|media|alta"
}

Se não houver prazo, retorne null para days e dueDate.`;

      let content: string | null;
      
      if (this.useGroq && this.groqApiKey) {
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto },
        ], 300);
      } else {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: texto },
          ],
          temperature: 0.2,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        });
        content = response.choices[0].message.content;
      }

      if (!content) return null;
      
      // Extrair JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const result: DeadlineExtraction = JSON.parse(content);
      
      if (!result.days) return null;

      // Calcular data usando dias úteis
      if (result.days) {
        const today = new Date();
        const dueDate = this.addBusinessDays(today, result.days);
        result.dueDate = dueDate.toISOString();
      }

      return result;
    } catch (error) {
      console.error('Erro ao extrair prazo:', error);
      return null;
    }
  }

  /**
   * Gera resumo rápido de um texto
   */
  async generateSummary(texto: string, maxWords: number = 50): Promise<string> {
    if (!this.isEnabled()) {
      return texto.substring(0, 200) + '...';
    }

    try {
      const systemPrompt = `Você é um assistente que resume textos jurídicos de forma clara e objetiva em no máximo ${maxWords} palavras.`;
      const userPrompt = `Resuma este texto:\n\n${texto}`;
      
      if (this.useGroq && this.groqApiKey) {
        const content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 200);
        return content || texto.substring(0, 200) + '...';
      } else {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 200,
        });
        return response.choices[0].message.content || texto.substring(0, 200) + '...';
      }
    } catch (error) {
      console.error('Erro ao gerar resumo:', error);
      return texto.substring(0, 200) + '...';
    }
  }

  /**
   * Analisa urgência de uma comunicação
   */
  async analyzeUrgency(
    texto: string,
    tipoDocumento?: string,
    tipoComunicacao?: string
  ): Promise<'baixa' | 'media' | 'alta' | 'critica'> {
    if (!this.isEnabled()) {
      // Fallback: análise simples por palavras-chave
      const textoLower = texto.toLowerCase();
      if (textoLower.includes('liminar') || textoLower.includes('tutela de urgência')) {
        return 'critica';
      }
      if (textoLower.includes('sentença') || textoLower.includes('prazo de 5 dias')) {
        return 'alta';
      }
      if (textoLower.includes('prazo')) {
        return 'media';
      }
      return 'baixa';
    }

    try {
      const systemPrompt = `Você é um especialista em classificar urgência de comunicações judiciais.
Classifique como: "critica", "alta", "media" ou "baixa".
Responda APENAS com uma palavra.`;
      const userPrompt = `Tipo: ${tipoDocumento || 'N/A'} | Comunicação: ${tipoComunicacao || 'N/A'}\nTexto: ${texto}`;
      
      let urgency: string;
      
      if (this.useGroq && this.groqApiKey) {
        urgency = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 10);
      } else {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 10,
        });
        urgency = response.choices[0].message.content || 'media';
      }

      const normalizedUrgency = urgency.toLowerCase().trim() as any;
      return ['critica', 'alta', 'media', 'baixa'].includes(normalizedUrgency) ? normalizedUrgency : 'media';
    } catch (error) {
      console.error('Erro ao analisar urgência:', error);
      return 'media';
    }
  }

  /**
   * Gera sugestões de ações baseado na intimação
   */
  async suggestActions(texto: string, prazo?: string): Promise<string[]> {
    if (!this.isEnabled()) {
      return ['Analisar intimação', 'Verificar prazos', 'Tomar providências'];
    }

    try {
      const systemPrompt = `Você é um assistente jurídico. Sugira 3-5 ações práticas e específicas que o advogado deve tomar.
Responda com um JSON: {"actions": ["ação 1", "ação 2", "ação 3"]}`;
      const userPrompt = `Intimação: ${texto}\nPrazo: ${prazo || 'Não especificado'}`;
      
      let content: string | null;
      
      if (this.useGroq && this.groqApiKey) {
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 300);
      } else {
        const response = await this.openai!.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        });
        content = response.choices[0].message.content;
      }

      if (!content) return [];
      
      // Extrair JSON da resposta
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        content = jsonMatch[0];
      }

      const result = JSON.parse(content);
      return result.actions || [];
    } catch (error) {
      console.error('Erro ao sugerir ações:', error);
      return [];
    }
  }
}

export const aiService = new AIService();
