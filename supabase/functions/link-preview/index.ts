import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const APP_BASE_URL = 'https://jurius.com.br';
const OG_IMAGE_BASE = 'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/og-image';

// User-agents do WhatsApp e outros scrapers de link preview
const BOT_PATTERNS = [
  'facebookexternalhit', 'facebot', 'whatsapp', 'twitterbot', 'linkedinbot',
  'slackbot', 'telegrambot', 'googlebot', 'bingbot', 'applebot', 'iframely',
];

function isBot(ua: string): boolean {
  const lower = ua.toLowerCase();
  return BOT_PATTERNS.some(b => lower.includes(b));
}

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ogHtml(title: string, description: string, imageUrl: string, canonicalUrl: string): string {
  const t = esc(title);
  const d = esc(description);
  const i = esc(imageUrl);
  const u = esc(canonicalUrl);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${u}" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:image" content="${i}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:site_name" content="Jurius" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${i}" />
  <meta http-equiv="refresh" content="0;url=${u}" />
</head>
<body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#fffdf7">
  <p>Redirecionando... <a href="${u}">Clique aqui</a></p>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' },
    });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);

  // Path: /functions/v1/link-preview/<tipo>/<token>
  // segments após o deploy: ['link-preview', 'assinar'|'preencher'|'p', token]
  // Extrair o tipo e token independentemente do prefixo
  let linkType: 'assinar' | 'preencher' | 'p' | null = null;
  let token: string | null = null;

  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === 'assinar' || segments[i] === 'preencher' || segments[i] === 'p') {
      linkType = segments[i] as 'assinar' | 'preencher' | 'p';
      token = segments[i + 1] || null;
      break;
    }
  }

  if (!linkType || !token) {
    return new Response('Not found', { status: 404 });
  }

  const spaUrl = `${APP_BASE_URL}/#/${linkType}/${token}`;
  const ua = req.headers.get('user-agent') || '';

  // Browser real → redirecionar direto para o SPA
  if (!isBot(ua)) {
    return new Response(null, {
      status: 302,
      headers: { Location: spaUrl },
    });
  }

  // Bot de preview → buscar dados e devolver OG HTML personalizado
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let ogImage = `${OG_IMAGE_BASE}/assinar`;
  let title = 'Jurius — Gestão Jurídica';
  let description = 'Plataforma de gerenciamento jurídico inteligente.';

  try {
    if (linkType === 'preencher' || linkType === 'p') {
      ogImage = `${OG_IMAGE_BASE}/preencher`;
    }

    if (linkType === 'assinar') {
      const { data } = await admin
        .from('signature_signers')
        .select('name, signature_requests(document_name)')
        .eq('public_token', token)
        .maybeSingle();

      if (data) {
        const docName = (data.signature_requests as any)?.document_name || 'Documento';
        const signerName = (data.name || '').split(' ')[0]; // primeiro nome
        title = signerName
          ? `${signerName}, seu documento chegou para assinar`
          : 'Seu documento chegou para assinar';
        description = `"${docName}" — Assine com segurança em poucos cliques.`;
      } else {
        title = 'Documento aguardando assinatura';
        description = 'Acesse o link para assinar o documento com segurança.';
      }
    } else if (linkType === 'preencher') {
      const { data } = await admin
        .from('template_fill_links')
        .select('document_templates(name)')
        .eq('public_token', token)
        .maybeSingle();

      if (data) {
        const templateName = (data.document_templates as any)?.name || 'Formulário';
        title = 'Formulário para preencher';
        description = `"${templateName}" — Preencha o formulário digital enviado pelo escritório.`;
      } else {
        title = 'Formulário digital';
        description = 'Preencha o formulário enviado pelo escritório.';
      }
    } else if (linkType === 'p') {
      const { data } = await admin
        .from('template_fill_permalinks')
        .select('document_templates(name)')
        .eq('slug', token)
        .eq('is_active', true)
        .maybeSingle();

      if (data) {
        const templateName = (data.document_templates as any)?.name || 'Formulário';
        title = 'Formulário para preencher';
        description = `"${templateName}" — Preencha o formulário digital enviado pelo escritório.`;
      } else {
        title = 'Formulário digital';
        description = 'Preencha o formulário enviado pelo escritório.';
      }
    }
  } catch {
    // Manter fallback genérico em caso de erro de DB
  }

  return new Response(ogHtml(title, description, ogImage, spaUrl), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
});
