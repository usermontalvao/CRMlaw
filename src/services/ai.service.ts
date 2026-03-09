import OpenAI from 'openai';
import type { IntimationAnalysis, AIServiceConfig, DeadlineExtraction } from '../types/ai.types';
import { supabase } from '../config/supabase';

class AIService {
  private openai: OpenAI | null = null;
  private enabled: boolean = false;
  private useEdgeFunction: boolean = true; // Usar Edge Function para evitar CORS
  private useGroq: boolean = false; // Usar OpenAI como provider principal
  private groqApiKey: string | null = null;
  private openaiApiKey: string | null = null;
  private lastGroqError: number = 0; // Timestamp do último erro 429
  private groqCooldownMs: number = 60000; // 1 minuto de cooldown após 429

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
    // Carrega ambas as chaves
    this.groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
    this.openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
    
    // Inicializa OpenAI se disponível (para fallback)
    if (this.openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: this.openaiApiKey,
        dangerouslyAllowBrowser: true,
      });
      console.log('✅ OpenAI configurado como fallback');
    }
    
    // OpenAI é o provider principal
    if (this.openaiApiKey && this.openai) {
      this.useGroq = false;
      this.enabled = true;
      console.log('✅ OpenAI AI Service inicializado (provider principal)');
      return;
    }
    
    // Se não tem OpenAI mas tem Groq, usa Groq como fallback
    if (this.groqApiKey) {
      this.useGroq = true;
      this.enabled = true;
      console.log('✅ Groq AI Service inicializado (provider fallback)');
      return;
    }
    
    console.warn('⚠️ IA desabilitada: configure VITE_GROQ_API_KEY ou VITE_OPENAI_API_KEY para ativar o serviço.');
    this.enabled = false;
    this.openai = null;
  }

  isEnabled(): boolean {
    return this.enabled && (this.groqApiKey !== null || this.openai !== null);
  }

  async generateText(systemPrompt: string, userPrompt: string, maxTokens: number = 800): Promise<string> {
    if (!this.isEnabled()) return '';

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    // Usar OpenAI primeiro
    if (this.openai && this.openaiApiKey) {
      if (this.useEdgeFunction) {
        return this.callOpenAIViaEdgeFunction(messages, 'gpt-4o-mini');
      } else {
        return this.callOpenAIDirectly(messages, maxTokens);
      }
    }

    // Fallback para Groq
    if (this.useGroq && this.groqApiKey) {
      return this.callGroqAPI(messages, maxTokens);
    }

    throw new Error('Nenhum provedor de IA disponível');
  }

  async editLegalTextWithContext(params: {
    instruction: string;
    selectedText: string;
    contextBlocks?: Array<{
      title: string;
      category?: string;
      tags?: string[];
      content: string;
    }>;
  }): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está disponível');
    }

    const instruction = String(params.instruction || '').trim();
    const selectedText = String(params.selectedText || '').trim();
    const contextBlocks = Array.isArray(params.contextBlocks) ? params.contextBlocks : [];

    if (!instruction) throw new Error('Informe a instrução de edição para a IA');
    if (!selectedText) throw new Error('Selecione um trecho do documento para editar');

    const formattedBlocks = contextBlocks
      .slice(0, 5)
      .map((block, index) => {
        const title = String(block.title || `Bloco ${index + 1}`).trim();
        const category = String(block.category || '').trim();
        const tags = Array.isArray(block.tags) ? block.tags.filter(Boolean).join(', ') : '';
        const content = String(block.content || '').trim().slice(0, 1800);

        return [
          `Bloco ${index + 1}: ${title}`,
          category ? `Categoria: ${category}` : '',
          tags ? `Tags: ${tags}` : '',
          'Conteúdo de referência:',
          content,
        ].filter(Boolean).join('\n');
      })
      .join('\n\n----------------\n\n');

    const systemPrompt = `Você é um editor jurídico especialista em petições brasileiras.

Sua função é editar APENAS o trecho selecionado de um documento jurídico, seguindo a instrução do usuário e usando os blocos fornecidos como base de conhecimento de estilo, estrutura argumentativa e vocabulário técnico.

Regras obrigatórias:
- Edite apenas o trecho selecionado, sem mencionar o restante do documento.
- Preserve o sentido jurídico quando a instrução não pedir mudança de tese.
- Não invente fatos, datas, números, nomes, pedidos, documentos ou fundamentos não presentes no trecho selecionado ou nos blocos de contexto.
- Use os blocos apenas como referência de linguagem, técnica e organização argumentativa.
- Mantenha o texto pronto para substituição direta no editor.
- Não use markdown.
- Não use cercas de código.
- Não adicione explicações, notas, títulos extras ou comentários.
- Retorne somente o texto final editado.`;

    const userPrompt = [
      `Instrução do usuário:\n${instruction}`,
      `Trecho selecionado para edição:\n${selectedText}`,
      formattedBlocks ? `Blocos de referência:\n${formattedBlocks}` : 'Blocos de referência: nenhum bloco relevante foi encontrado.',
      'Retorne apenas a versão final editada do trecho selecionado.',
    ].join('\n\n');

    const content = await this.generateText(systemPrompt, userPrompt, 1200);
    const output = String(content || '').trim();

    if (!output) {
      throw new Error('IA não retornou texto para a edição solicitada');
    }

    return output;
  }

  /**
   * Verifica se deve usar fallback OpenAI (Groq em cooldown)
   */
  private shouldUseFallback(): boolean {
    if (!this.openai || !this.openaiApiKey) return false;
    if (this.lastGroqError === 0) return false;
    return Date.now() - this.lastGroqError < this.groqCooldownMs;
  }

  /**
   * Marca Groq como em cooldown (após erro 429)
   */
  private setGroqCooldown() {
    this.lastGroqError = Date.now();
    console.warn('⚠️ Groq rate limited, usando OpenAI como fallback por 1 minuto');
  }

  /**
   * Chama a API do Groq com fallback para OpenAI
   */
  private async callGroqAPI(messages: any[], maxTokens: number = 1000): Promise<string> {
    // Se Groq está em cooldown e temos OpenAI, usa fallback
    if (this.shouldUseFallback()) {
      console.log('🔄 Usando OpenAI (fallback) - Groq em cooldown');
      return this.callOpenAIDirectly(messages, maxTokens);
    }

    try {
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
        
        // Se for rate limit (429), tenta fallback OpenAI
        if (response.status === 429 && this.openai) {
          this.setGroqCooldown();
          console.log('🔄 Groq retornou 429, tentando OpenAI...');
          return this.callOpenAIDirectly(messages, maxTokens);
        }
        
        throw new Error(`Groq API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error: any) {
      // Se falhou e temos OpenAI disponível, tenta fallback
      if (this.openai && error.message?.includes('429')) {
        this.setGroqCooldown();
        console.log('🔄 Erro no Groq, tentando OpenAI...');
        return this.callOpenAIDirectly(messages, maxTokens);
      }
      throw error;
    }
  }

  /**
   * Chama a OpenAI API diretamente (fallback)
   */
  private async callOpenAIDirectly(messages: any[], maxTokens: number = 1000): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI não configurado para fallback');
    }

    const response = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Chama a OpenAI API através da Edge Function do Supabase (evita CORS)
   */
  private async callOpenAIViaEdgeFunction(messages: any[], model: string = 'gpt-4o-mini'): Promise<string> {
    const { data, error } = await supabase.functions.invoke('openai-proxy', {
      body: { messages, model },
    });

    if (error) {
      throw new Error(`Edge Function error: ${error.message}`);
    }

    return data?.choices?.[0]?.message?.content || '';
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

      let content: string | null = null;

      // Usar OpenAI primeiro
      if (this.openai && this.openaiApiKey) {
        if (this.useEdgeFunction) {
          // Usa Edge Function para evitar CORS
          content = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], 'gpt-4o-mini');
        } else {
          // Usa OpenAI diretamente
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
      } else if (this.useGroq && this.groqApiKey) {
        // Usa Groq API como fallback
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 1000);
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

      let content: string | null = null;
      
      // Usar OpenAI primeiro
      if (this.openai && this.openaiApiKey) {
        if (this.useEdgeFunction) {
          content = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: texto },
          ], 'gpt-4o-mini');
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
      } else if (this.useGroq && this.groqApiKey) {
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: texto },
        ], 300);
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
      
      // Usar OpenAI primeiro
      if (this.openai && this.openaiApiKey) {
        if (this.useEdgeFunction) {
          const content = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], 'gpt-4o-mini');
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
      } else if (this.useGroq && this.groqApiKey) {
        const content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 200);
        return content || texto.substring(0, 200) + '...';
      } else {
        return texto.substring(0, 200) + '...';
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
      
      // Usar OpenAI primeiro
      if (this.openai && this.openaiApiKey) {
        if (this.useEdgeFunction) {
          urgency = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], 'gpt-4o-mini');
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
      } else if (this.useGroq && this.groqApiKey) {
        urgency = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 10);
      } else {
        urgency = 'media';
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
      
      let content: string | null = null;
      
      // Usar OpenAI primeiro
      if (this.openai && this.openaiApiKey) {
        if (this.useEdgeFunction) {
          content = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], 'gpt-4o-mini');
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
      } else if (this.useGroq && this.groqApiKey) {
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 300);
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

  /**
   * Formata texto usando IA - funciona para qualquer tipo de texto
   * Detecta automaticamente o tipo de texto e aplica formatação apropriada
   */
  async formatQualification(rawText: string): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Serviço de IA não está disponível');
    }

    const systemPrompt = `Você é um assistente jurídico especializado em formatação e correção de documentos. Analise o texto fornecido e aplique as melhorias necessárias:

TIPOS DE TEXTO E FORMATAÇÃO:

1. QUALIFICAÇÃO DE PARTE:
   - Formato: NOME COMPLETO EM MAIÚSCULAS, nacionalidade, estado civil, profissão, inscrito(a) no CPF sob o nº XXX.XXX.XXX-XX, residente e domiciliado(a) na [logradouro] [nome], nº [número], Bairro [bairro], [cidade] – [UF], CEP [cep]
   - Exemplo: ADAILTON GOMES LUCINDO, brasileiro, solteiro, atendente de balcão, inscrito no CPF sob o nº 123.456.789-00, residente e domiciliado na Rua das Flores, nº 123, Bairro Centro, São Paulo – SP, CEP 01234-567

2. ENDEREÇO SIMPLES:
   - Formato: [logradouro] [nome], nº [número], Bairro [bairro], [cidade] – [UF], CEP [cep]
   - Exemplo: Rua das Flores, nº 123, Bairro Centro, São Paulo – SP, CEP 01234-567

3. TEXTO JURÍDICO GERAL:
   - Mantenha a estrutura mas melhore gramática e pontuação
   - Use linguagem formal e técnica jurídica
   - Organize parágrafos se necessário

4. LISTAS OU ENUMERAÇÕES:
   - Use numeração adequada (1., 2., 3. ou a), b), c))
   - Mantenha coerência na formatação

CORREÇÕES OBRIGATÓRIAS (PARA QUALQUER TEXTO):
- Correção ortográfica completa
- Remoção de espaços extras no início, fim e entre palavras
- Correção de pontuação (vírgulas, pontos, acentos)
- Padronização de maiúsculas/minúsculas
- Remoção de linhas em branco desnecessárias
- Consistência em abreviações (Ex: nº, art., §)

FORMATAÇÃO:
- Use espaços simples após pontuação (vírgula, ponto, dois pontos)
- Mantenha um espaço entre números e unidades (ex: 5 cm, 10 dias)
- Use travessão (–) para separar cidade-UF
- Formate CPF como XXX.XXX.XXX-XX e CEP como XXXXX-XXX
- Use negrito apenas para nomes em qualificações (o editor cuidará disso)

REGRAS GERAIS:
- Preserve informações importantes (nomes, números, datas)
- Use português brasileiro padrão
- Mantenha coesão e coerência
- Seja conciso mas completo

Retorne APENAS o texto corrigido e formatado, sem explicações.`;

    const userPrompt = `Texto para formatar:
${rawText}`;

    let content = '';

    try {
      // Usar Groq primeiro (mais barato)
      if (this.useGroq && this.groqApiKey) {
        // Usa Groq API como principal
        content = await this.callGroqAPI([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ], 300);
      } else if (this.openai && this.openaiApiKey) {
        // Usa OpenAI como fallback
        if (this.useEdgeFunction) {
          // Usa Edge Function para evitar CORS
          content = await this.callOpenAIViaEdgeFunction([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ], 'gpt-4o-mini');
        } else {
          // Usa OpenAI diretamente
          const response = await this.openai!.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 300,
          });
          content = response.choices[0].message.content || '';
        }
      }

      if (!content) {
        throw new Error('IA não retornou resposta');
      }

      return content.trim();
    } catch (error) {
      console.error('Erro ao formatar qualificação:', error);
      throw new Error('Falha ao formatar qualificação com IA');
    }
  }
}

export const aiService = new AIService();
