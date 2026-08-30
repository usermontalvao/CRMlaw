import { useEffect, useState } from 'react';
import { signatureService } from '../services/signature.service';
import { fotosDeClientePorWhatsApp } from '../services/whatsapp/fotoDoCliente';

/**
 * Resolve a foto de cada cliente para exibição (lista, timeline, etc.)
 * Estratégia em camadas, com cache em localStorage:
 *   1) photo_path pinado no cadastro → URL assinada direta (rápido)
 *   2) Sem pinada → foto de perfil do WhatsApp do contato vinculado
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

    /**
     * A selfie da assinatura NÃO é mais usada como foto de cliente.
     *
     * Ela existe como prova; dar a ela uma segunda finalidade enfraquece a
     * primeira. A foto vem do WhatsApp do contato vinculado — dado que o
     * próprio cliente publicou para ser visto por quem conversa com ele.
     */
    const resolveFromWhatsApp = async (pendentes: ClientLike[]): Promise<Array<[string, string]>> => {
      const achados: Array<[string, string]> = [];
      try {
        const fotos = await fotosDeClientePorWhatsApp(pendentes.map((c) => c.id));
        for (const c of pendentes) {
          const excluded = new Set<string>(Array.isArray(c.excluded_photo_paths) ? c.excluded_photo_paths : []);
          const foto = fotos.get(c.id);
          if (foto && !excluded.has(foto.path)) {
            cache[c.id] = { url: foto.url, path: foto.path, expiresAt: now + PHOTO_CACHE_TTL_MS };
            achados.push([c.id, foto.url]);
          } else {
            cache[c.id] = { miss: true, expiresAt: now + MISS_CACHE_TTL_MS };
          }
        }
      } catch {
        /* sem foto: não marca miss, para tentar de novo na próxima montagem */
      }
      return achados;
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
      // O WhatsApp resolve o lote inteiro numa consulta só — não precisa do
      // runBatched, que existia para não disparar N buscas de assinatura.
      const doWhatsApp = await resolveFromWhatsApp(unpinned);
      if (cancelled || doWhatsApp.length === 0) { saveCache(cache); return; }
      setPhotoUrls((prev) => {
        const next = new Map(prev);
        doWhatsApp.forEach(([id, url]) => next.set(id, url));
        return next;
      });
      saveCache(cache);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients]);

  return photoUrls;
}
