/**
 * whatsapp-ai-flow — encaminhador para o motor do atendente.
 *
 * O motor vive em `whatsapp-agent`. Este nome continua existindo porque o
 * `evolution-webhook` já o chama: reapontar lá exigiria redeployar a função
 * mais crítica do sistema (ingestão de TODA mensagem recebida) só para trocar
 * uma string de URL. Não se justifica o risco — encaminhar daqui custa um pulo
 * interno e deixa o webhook intocado.
 *
 * ⚠️ ESTA FUNÇÃO PRECISA DE PORTA PRÓPRIA. Ela sobe com verify_jwt=false (o
 * chamador é interno e não manda JWT de usuário) e encaminha com a service key.
 * Sem a checagem abaixo, seria um endpoint aberto que escala privilégio: quem
 * conhecesse a URL poderia rodar o agente em qualquer conversa. Falha FECHADA.
 *
 * O questionário sequencial de playbooks que existia aqui foi aposentado; nunca
 * chegou a rodar em produção. Ver docs/WHATSAPP_ATENDENTE_IA.md §Histórico.
 */
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AI_TOKEN = Deno.env.get('WA_AI_TOKEN') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const qs = new URL(req.url).searchParams.get('token') || '';
  const aceitos = [AI_TOKEN, SERVICE_KEY].filter(Boolean);

  if (!aceitos.includes(bearer) && !aceitos.includes(qs)) {
    // Mensagem explícita de propósito: se o atendente parar de rodar, este log
    // diz na hora que a causa é credencial, não o motor.
    console.error('whatsapp-ai-flow: chamada sem credencial válida — o chamador precisa mandar WA_AI_TOKEN ou a service key');
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await req.text();

  const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body,
    // Maior que o do chamador de propósito: o motor agrupa mensagens antes de
    // falar com o modelo. Quem chama roda em waitUntil e não fica esperando.
    signal: AbortSignal.timeout(180_000),
  }).catch((err) => {
    console.error('encaminhamento falhou', err);
    return null;
  });

  if (!res) return new Response(JSON.stringify({ error: 'motor indisponível' }), { status: 502 });
  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
