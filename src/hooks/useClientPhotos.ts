import { useEffect, useState } from 'react';
import { signatureService } from '../services/signature.service';

/**
 * Resolve a foto de cada cliente para exibição (lista, timeline, etc.)
 * Estratégia em camadas, com cache em localStorage:
 *   1) photo_path pinado no cadastro → URL assinada direta (rápido)
 *   2) Sem pinada → foto facial da assinatura digital mais recente
 *   3) Sem nada → marca "miss" por 24h (não refaz busca)
 *
 * Reutilizável em qualquer módulo que precise mostrar avatar de cliente.
 */

const PHOTO_CACHE_KEY = 'jurius.clientPhotoCache.v1';
const PHOTO_CACHE_TTL_MS = 50 * 60 * 1000; // 50min (URL assinada vale 60min)
const MISS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h para "sem foto"

type CacheEntry = { url?: string; path?: string; expiresAt: number; miss?: boolean };

type ClientLike = { id: string; photo_path?: string | null; excluded_photo_paths?: string[] | null };

const loadCache = (): Record<string, CacheEntry> => {
  try {
    const raw = localStorage.getItem(PHOTO_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveCache = (cache: Record<string, CacheEntry>) => {
  try {
    localStorage.setItem(PHOTO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — ignora */
  }
};

export function useClientPhotos(clients: ClientLike[]): Map<string, string> {
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(() => {
    const cache = loadCache();
    const now = Date.now();
    const map = new Map<string, string>();
    Object.entries(cache).forEach(([id, entry]) => {
      if (entry.url && entry.expiresAt > now) map.set(id, entry.url);
    });
    return map;
  });

  useEffect(() => {
    if (!clients || clients.length === 0) return;
    const cache = loadCache();
    const now = Date.now();

    const targets = clients.filter((c) => {
      if (!c?.id) return false;
      if (photoUrls.has(c.id)) return false;
      const cached = cache[c.id];
      if (cached) {
        if (cached.url && cached.expiresAt > now) return false;
        if (cached.miss && cached.expiresAt > now) return false;
      }
      return true;
    });
    if (targets.length === 0) return;

    let cancelled = false;

    const tryUrl = async (path: string): Promise<string | null> => {
      try {
        return await signatureService.getSignedImageUrl(path, 3600);
      } catch {
        return null;
      }
    };

    const resolvePinned = async (c: ClientLike): Promise<[string, string] | null> => {
      if (!c.photo_path) return null;
      const url = await tryUrl(c.photo_path);
      if (url) {
        cache[c.id] = { url, path: c.photo_path, expiresAt: now + PHOTO_CACHE_TTL_MS };
        return [c.id, url];
      }
      return null;
    };

    const resolveFromSignatures = async (c: ClientLike): Promise<[string, string] | null> => {
      const excluded = new Set<string>(Array.isArray(c.excluded_photo_paths) ? c.excluded_photo_paths : []);
      try {
        const requests = await signatureService.listRequestsWithSigners({ client_id: c.id });
        const signed = requests
          .filter((r: any) => r.status === 'signed')
          .sort(
            (a: any, b: any) =>
              new Date(b.signed_at || b.updated_at).getTime() -
              new Date(a.signed_at || a.updated_at).getTime(),
          );
        for (const req of signed) {
          for (const signer of req.signers ?? []) {
            // LGPD: só usa a selfie da assinatura como foto de cliente quando o
            // signatário autorizou explicitamente (consentimento separado).
            if (
              signer.facial_image_path &&
              signer.status === 'signed' &&
              signer.allow_signature_selfie_for_profile === true &&
              !excluded.has(signer.facial_image_path)
            ) {
              const url = await tryUrl(signer.facial_image_path);
              if (url) {
                cache[c.id] = { url, path: signer.facial_image_path, expiresAt: now + PHOTO_CACHE_TTL_MS };
                return [c.id, url];
              }
            }
          }
          // Nota: a selfie no nível da request (modelo legado) não possui
          // consentimento individual e por isso NÃO é usada como foto cadastral.
        }
      } catch {
        /* sem foto */
      }
      cache[c.id] = { miss: true, expiresAt: now + MISS_CACHE_TTL_MS };
      return null;
    };

    const runBatched = async (
      items: ClientLike[],
      worker: (c: ClientLike) => Promise<[string, string] | null>,
      concurrency: number,
    ) => {
      for (let i = 0; i < items.length; i += concurrency) {
        if (cancelled) return;
        const batch = items.slice(i, i + concurrency);
        const results = await Promise.all(batch.map(worker));
        if (cancelled) return;
        setPhotoUrls((prev) => {
          const next = new Map(prev);
          results.forEach((e) => {
            if (e) next.set(e[0], e[1]);
          });
          return next;
        });
        saveCache(cache);
      }
    };

    (async () => {
      const pinned = targets.filter((c) => c.photo_path);
      const unpinned = targets.filter((c) => !c.photo_path);
      await runBatched(pinned, resolvePinned, 12);
      if (cancelled) return;
      await runBatched(unpinned, resolveFromSignatures, 4);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  return photoUrls;
}
