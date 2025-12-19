import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { templateFillPermalinkService } from '../services/templateFillPermalink.service';

/**
 * Página de redirecionamento para links fixos (permalinks).
 * 
 * Rota: /#/p/:slug
 * 
 * Quando acessada:
 * 1. Chama a Edge Function template-fill-mint com o slug
 * 2. Recebe um token único de preenchimento
 * 3. Redireciona para /#/preencher/:token
 * 
 * Isso permite ter um link fixo para WhatsApp que nunca expira.
 */
const PublicPermalinkRedirect: React.FC = () => {
  const [slug, setSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // App usa roteamento manual via hashRoute no App.tsx (sem react-router).
    // Extrair slug do hash ou do pathname.
    const hash = typeof window !== 'undefined' ? (window.location.hash || '') : '';
    const pathname = typeof window !== 'undefined' ? (window.location.pathname || '') : '';

    const extracted =
      hash.includes('/p/')
        ? hash.split('/p/')[1]?.split('?')[0]?.split('#')[0]
        : pathname.includes('/p/')
          ? pathname.split('/p/')[1]?.split('?')[0]?.split('#')[0]
          : '';

    const cleanSlug = (extracted || '').trim();
    setSlug(cleanSlug || null);

    if (!cleanSlug) {
      setError('Link inválido');
      setLoading(false);
      return;
    }

    const mintAndRedirect = async (slugToMint: string) => {
      try {
        const result = await templateFillPermalinkService.mintToken(slugToMint);

        if (!result.success || !result.token) {
          setError(result.error || 'Link não encontrado ou expirado');
          setLoading(false);
          return;
        }

        // Redirecionar para o formulário de preenchimento (hash routing)
        window.location.hash = `#/preencher/${result.token}`;
      } catch (err: any) {
        console.error('Erro ao processar link:', err);
        setError(err?.message || 'Erro ao processar link');
        setLoading(false);
      }
    };

    mintAndRedirect(cleanSlug);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-md w-full text-center">
          <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-rose-600" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-2">Link indisponível</h1>
          <p className="text-sm text-slate-600">{error}</p>
          {slug && (
            <p className="mt-3 text-xs text-slate-400 break-all">{slug}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-md w-full text-center">
        <Loader2 className="w-8 h-8 animate-spin text-orange-600 mx-auto mb-4" />
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Preparando formulário...</h1>
        <p className="text-sm text-slate-600">Aguarde um momento</p>
      </div>
    </div>
  );
};

export default PublicPermalinkRedirect;
