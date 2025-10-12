import OpenAI from 'openai';
import type { IntimationAnalysis, AIServiceConfig, DeadlineExtraction } from '../types/ai.types';

class AIService {
  private openai: OpenAI | null = null;
  private enabled: boolean = false;

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
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      console.warn('⚠️ OpenAI API Key não configurada. Funcionalidades de IA desabilitadas.');
      this.enabled = false;
      return;
    }

    try {
      this.openai = new OpenAI({
        apiKey,
        dangerouslyAllowBrowser: true, // Para uso no cliente
      });
      this.enabled = true;
      console.log('✅ OpenAI AI Service inicializado');
    } catch (error) {
      console.error('❌ Erro ao inicializar OpenAI:', error);
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.openai !== null;
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

      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3, // Baixa temperatura para respostas mais consistentes
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0].message.content;
      if (!content) {
        throw new Error('Resposta vazia da API');
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

      const content = response.choices[0].message.content;
      if (!content) return null;

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
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente que resume textos jurídicos de forma clara e objetiva em no máximo ${maxWords} palavras.`,
          },
          {
            role: 'user',
            content: `Resuma este texto:\n\n${texto}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      return response.choices[0].message.content || texto.substring(0, 200) + '...';
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
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em classificar urgência de comunicações judiciais.
Classifique como: "critica", "alta", "media" ou "baixa".
Responda APENAS com uma palavra.`,
          },
          {
            role: 'user',
            content: `Tipo: ${tipoDocumento || 'N/A'} | Comunicação: ${tipoComunicacao || 'N/A'}\nTexto: ${texto}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 10,
      });

      const urgency = response.choices[0].message.content?.toLowerCase().trim() as any;
      return ['critica', 'alta', 'media', 'baixa'].includes(urgency) ? urgency : 'media';
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
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente jurídico. Sugira 3-5 ações práticas e específicas que o advogado deve tomar.
Responda com um JSON: {"actions": ["ação 1", "ação 2", "ação 3"]}`,
          },
          {
            role: 'user',
            content: `Intimação: ${texto}\nPrazo: ${prazo || 'Não especificado'}`,
          },
        ],
        temperature: 0.4,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      });

      const content = response.choices[0].message.content;
      if (!content) return [];

      const result = JSON.parse(content);
      return result.actions || [];
    } catch (error) {
      console.error('Erro ao sugerir ações:', error);
      return [];
    }
  }
}

export const aiService = new AIService();
