import React, { useCallback, useEffect, useState } from 'react';
import { FilePlus2, FilePen, FolderInput, History, Loader2, Trash2 } from 'lucide-react';
import { nextcloudService, type NextcloudChangeEvent } from '../../services/nextcloud.service';
import { extIcon, fileIconColorClass } from '../../utils/nextcloudFile';
import { formatRelativeTime } from '../../utils/relativeTime';
import { NC_FOCUS_RING, NC_HAIRLINE, NC_HOVER, NC_TEXT, NC_TEXT_FAINT, NC_TEXT_MUTED, NC_TEXT_STRONG } from './ncTokens';

/**
 * NextcloudRecentActivity — "o que mudou por último", no fim da home.
 * -----------------------------------------------------------------------------
 * Sai da fila de eventos do webhook (`nextcloud_change_events`), não da data de
 * modificação das pastas. A diferença importa: aqui aparece o documento que um
 * colega alterou numa subpasta funda, que ninguém encontraria navegando, e
 * aparece QUEM alterou.
 *
 * Duas honestidades embutidas:
 *   - só mostra o que aconteceu DEPOIS que o webhook passou a funcionar. Sem
 *     eventos, o bloco explica isso em vez de fingir que o Nextcloud está
 *     parado;
 *   - item apagado continua na lista (é informação: sumiu, e por causa de
 *     quem), mas não é clicável — levar a um 404 seria pior que não levar.
 */

type RecentItem = {
  key: string;
  path: string;
  name: string;
  folder: string;
  action: 'created' | 'written' | 'deleted' | 'renamed' | 'copied';
  actor: string | null;
  at: string;
};

const ACTION_LABEL: Record<RecentItem['action'], string> = {
  created: 'adicionado',
  written: 'alterado',
  deleted: 'apagado',
  renamed: 'renomeado ou movido',
  copied: 'copiado',
};

const ACTION_ICON: Record<RecentItem['action'], React.ComponentType<{ className?: string }>> = {
  created: FilePlus2,
  written: FilePen,
  deleted: Trash2,
  renamed: FolderInput,
  copied: FilePlus2,
};

function actionOf(eventClass: string): RecentItem['action'] {
  if (eventClass.includes('NodeCreated')) return 'created';
  if (eventClass.includes('NodeDeleted')) return 'deleted';
  if (eventClass.includes('NodeRenamed')) return 'renamed';
  if (eventClass.includes('NodeCopied')) return 'copied';
  return 'written';
}

/** Caminho que o evento diz respeito — o destino, quando houve movimentação. */
function pathOf(event: NextcloudChangeEvent): string | null {
  const raw = event.targetPath || event.nodePath || event.sourcePath;
  return raw ? String(raw).replace(/^\/+/, '').replace(/\/+$/, '') || null : null;
}

/** Um arquivo salvo três vezes seguidas é UMA linha, a mais recente. */
export function toRecentItems(events: NextcloudChangeEvent[], limit: number): RecentItem[] {
  const seen = new Set<string>();
  const items: RecentItem[] = [];
  for (const event of events) {
    const path = pathOf(event);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const segments = path.split('/');
    items.push({
      key: event.id || path,
      path,
      name: segments[segments.length - 1] || path,
      folder: segments.slice(0, -1).join('/'),
      action: actionOf(event.eventClass),
      actor: event.actorName,
      at: event.createdAt,
    });
    if (items.length >= limit) break;
  }
  return items;
}

interface NextcloudRecentActivityProps {
  limit?: number;
  /** Recarrega quando muda — o explorador incrementa a cada evento do Realtime. */
  revision: number;
  /** Abrir = ir até a pasta do item e deixá-lo selecionado lá. Não tentamos
      abrir o arquivo direto: o evento só traz nome e caminho, e inventar
      tamanho/mime para decidir visualizador é chute. */
  onOpen: (item: { path: string; folder: string }) => void;
}

export const NextcloudRecentActivity: React.FC<NextcloudRecentActivityProps> = ({
  limit = 10,
  revision,
  onOpen,
}) => {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const events = await nextcloudService.recentChanges();
      setItems(toRecentItems(events, limit));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as mudanças recentes.');
      setItems([]);
    }
  }, [limit]);

  useEffect(() => { void load(); }, [load, revision]);

  return (
    <section className={`border-t px-3 py-4 sm:px-4 ${NC_HAIRLINE}`} aria-label="Alterações recentes">
      <h2 className={`mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] ${NC_TEXT_FAINT}`}>
        <History className="h-3.5 w-3.5" /> Últimas alterações
      </h2>

      {items === null ? (
        <p className={`flex items-center gap-2 py-3 text-[13px] ${NC_TEXT_MUTED}`}>
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : error ? (
        <p className={`py-3 text-[13px] ${NC_TEXT_MUTED}`}>{error}</p>
      ) : items.length === 0 ? (
        <p className={`py-3 text-[13px] ${NC_TEXT_MUTED}`}>
          Nenhuma alteração registrada ainda. Esta lista mostra o que o Nextcloud avisa por webhook —
          o que foi feito antes de ele ser ligado não aparece aqui.
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {items.map((item) => {
            const Icon = extIcon({ name: item.name, path: item.path, isDir: false, size: 0, mime: '', mtime: null });
            const ActionIcon = ACTION_ICON[item.action];
            const removed = item.action === 'deleted';
            const content = (
              <>
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                  <Icon className={`h-5 w-5 ${removed ? NC_TEXT_FAINT : fileIconColorClass({ name: item.name, path: item.path, isDir: false, size: 0, mime: '', mtime: null })}`} />
                  <ActionIcon className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-white dark:bg-zinc-900 ${removed ? 'text-red-500' : 'text-slate-400'}`} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`truncate text-[13px] ${removed ? `line-through ${NC_TEXT_MUTED}` : NC_TEXT_STRONG}`} title={item.path}>
                    {item.name}
                  </span>
                  <span className={`truncate text-[11px] ${NC_TEXT_MUTED}`}>
                    {ACTION_LABEL[item.action]}
                    {item.actor ? ` por ${item.actor}` : ''}
                    {item.folder ? ` · em ${item.folder}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 text-[11px] ${NC_TEXT_FAINT}`}>{formatRelativeTime(item.at)}</span>
              </>
            );

            return (
              <li key={item.key}>
                {removed ? (
                  <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" aria-disabled="true">{content}</div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpen({ path: item.path, folder: item.folder })}
                    title={`Ir até ${item.name}`}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${NC_TEXT} ${NC_HOVER} ${NC_FOCUS_RING}`}
                  >
                    {content}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default NextcloudRecentActivity;
