const PUBLIC_APP_FALLBACK_URL = 'https://jurius.com.br';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function currentOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  const origin = normalizeBaseUrl(window.location.origin);
  if (!origin) return null;

  try {
    const url = new URL(origin);
    if (LOCAL_HOSTS.has(url.hostname)) return null;
  } catch {
    return null;
  }

  return origin;
}

export function getPublicAppBaseUrl(): string {
  const envUrl = normalizeBaseUrl(
    import.meta.env.VITE_PUBLIC_APP_URL
    || import.meta.env.VITE_APP_URL
    || import.meta.env.VITE_SITE_URL,
  );

  return envUrl || currentOrigin() || PUBLIC_APP_FALLBACK_URL;
}

export function buildPublicHashUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getPublicAppBaseUrl()}/#${normalizedPath}`;
}

export function buildPublicFillUrl(token: string): string {
  return buildPublicHashUrl(`/preencher/${token}`);
}

export function buildPublicSigningUrl(token: string): string {
  return buildPublicHashUrl(`/assinar/${token}`);
}

export function buildPublicVerificationUrl(hash: string): string {
  return buildPublicHashUrl(`/verificar/${hash}`);
}

export function buildPublicDocumentUrl(token: string): string {
  return buildPublicHashUrl(`/documento/${token}`);
}

export function buildPublicPermalinkUrl(slug: string): string {
  return buildPublicHashUrl(`/p/${slug}`);
}

/**
 * URL de compartilhamento via WhatsApp dos kits de preenchimento/assinatura.
 *
 * Aponta direto para a rota do SPA no próprio domínio (ex.:
 * jurius.com.br/#/preencher/<token>) — link de marca e que funciona sem depender
 * de regras de proxy na borda (o serviço Render em produção ignora a seção
 * `routes` do render.yaml, então `/l/...` dava 404).
 *
 * Trade-off: sem o card de preview rico (OG tags) que o edge function
 * `link-preview` gera. Para recuperar o card MANTENDO o domínio, é preciso uma
 * regra de proxy na BORDA (Cloudflare Worker/Redirect Rule em jurius.com.br/l/*
 * → functions/v1/link-preview, ou domínio custom do Supabase) — config de
 * dashboard, fora do repositório. Enquanto isso não existe, este link direto é o
 * comportamento correto e funcional.
 */
export function buildWaPreviewUrl(linkType: 'assinar' | 'preencher' | 'p', token: string): string {
  return buildPublicHashUrl(`/${linkType}/${token}`);
}

/** Página pública dos Termos de Uso da Assinatura (versionada). */
export function buildPublicSignatureTermsUrl(version?: string | null): string {
  return buildPublicHashUrl(version ? `/termos-assinatura/${version}` : '/termos-assinatura');
}
