import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisResult {
  valid: boolean;
  score: number;
  issues: string[];
  message: string;
}

function normalizeText(input: unknown): string {
  return String(input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function shouldForceAccept(result: AnalysisResult): boolean {
  if (result.valid) return false;

  const issuesText = Array.isArray(result.issues) ? result.issues.join(' ') : '';
  const text = normalizeText(`${result.message} ${issuesText}`);

  const hasNoFace =
    /sem\s+rosto/.test(text) ||
    /(nao|n[aã]o)\s+(ha|tem)\s+rosto/.test(text) ||
    /nenhum\s+rosto/.test(text) ||
    /(rosto|face)\s+nao\s+(visivel|aparece)/.test(text);

  const hasObstruction =
    /obstruc/.test(text) ||
    /(cobr|cobert|tapad|tapando|ocult)/.test(text) ||
    /(mao|m[ãa]o)/.test(text) ||
    /objeto/.test(text);

  const hasSevereBlur =
    /muito\s+borr/.test(text) ||
    /extremamente\s+borr/.test(text) ||
    /(impossivel|nao\s+da)\s+.*(identificar|reconhecer)/.test(text) ||
    /(rosto|face)\s+.*(irreconhec|indistinguivel)/.test(text);

  // Se o único problema for "clareza"/"borrão leve"/"iluminação", não bloquear.
  const blurOrClarityOnly =
    /(borr|nitid|clara|clareza|foco|granulad|pixelad)/.test(text) ||
    /(ilumin|escura|clara demais)/.test(text);

  if (hasNoFace || hasObstruction || hasSevereBlur) return false;
  return blurOrClarityOnly;
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const supabaseAdmin = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

async function validatePublicSigningToken(token: string): Promise<boolean> {
  if (!token) return false;
  if (!supabaseAdmin) return false;

  const { data, error } = await supabaseAdmin.rpc('get_public_signing_bundle', { p_token: token });
  if (error) return false;
  if (!data?.request?.id) return false;
  return true;
}

async function validateAuthenticatedUser(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return false;
  if (!supabaseUrl || !supabaseAnonKey) {
    // Se não tiver ANON KEY no ambiente, não bloquear para não quebrar.
    return true;
  }

  const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const { data } = await supabaseAuth.auth.getUser();
  return Boolean(data?.user);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload = await req.json().catch(() => null);
    const imageBase64 = String(payload?.imageBase64 ?? '').trim();
    const token = String(payload?.token ?? '').trim();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'imageBase64 é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const allowedByToken = token ? await validatePublicSigningToken(token) : false;
    const allowedByAuth = allowedByToken ? false : await validateAuthenticatedUser(req as Request);
    if (!allowedByToken && !allowedByAuth) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY não configurada');
    }

    // Remover prefixo data:image/... se existir
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um analisador de selfies para assinatura eletrônica.

Regras de reprovação (CRÍTICAS):
1. Não há um rosto humano claramente visível
2. O rosto está obstruído (mão, objeto, óculos/boné cobrindo grande parte do rosto, etc.)
3. A foto está muito borrada / tremida a ponto de não dar para identificar o rosto

Importante:
- NÃO reprovar por iluminação (clara/escura) se o rosto ainda estiver visível.
- Enquadramento/centralização NÃO é motivo de reprovação por si só.

Responda APENAS em JSON válido com a estrutura:
{
  "valid": true/false,
  "score": 0-100,
  "issues": ["lista de problemas encontrados"],
  "message": "mensagem amigável para o usuário"
}

Defina valid=true se NÃO houver nenhum problema crítico.
Score guia:
- 85-100: rosto bem visível e nítido
- 70-84: rosto visível e aceitável
- 0-69: algum problema crítico (sem rosto, obstrução, muito borrada)

Se a foto não for válida, a message deve pedir para tirar nova foto e mencionar especificamente o problema (ex.: "retire a mão do rosto" ou "tire sem tremer").`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Analise esta foto facial para assinatura eletrônica:'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Data}`,
                  detail: 'low'
                }
              }
            ]
          }
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('OpenAI API error:', error);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Tentar parsear o JSON da resposta
    let result: AnalysisResult;
    try {
      // Extrair JSON da resposta (pode vir com markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('JSON não encontrado na resposta');
      }
    } catch (parseError) {
      console.error('Erro ao parsear resposta:', content);
      // Fallback: considerar válido se não conseguir parsear
      result = {
        valid: true,
        score: 75,
        issues: [],
        message: 'Foto aceita'
      };
    }

    if (shouldForceAccept(result)) {
      result = {
        valid: true,
        score: Math.max(Number(result.score) || 0, 72),
        issues: [],
        message: 'Foto aceita',
      };
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Erro na análise:', error);
    return new Response(
      JSON.stringify({ 
        error: (error as any)?.message ?? String(error),
        valid: true, // Em caso de erro, aceitar a foto para não bloquear o usuário
        score: 50,
        issues: ['Não foi possível analisar a foto'],
        message: 'Não foi possível validar a foto automaticamente. Prossiga com a assinatura.'
      }),
      {
        status: 200, // Retornar 200 mesmo com erro para não bloquear
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
