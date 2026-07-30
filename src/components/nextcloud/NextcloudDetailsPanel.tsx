import React from 'react';
import { Download, Eye, History, Info, UserPlus, X } from 'lucide-react';
import type { NextcloudEntry } from '../../services/nextcloud.service';
import type { EditingPeer } from '../../hooks/useNextcloudPresence';
import EditingNowBadge from '../EditingNowBadge';
import { NcThumb } from './NcThumb';
import {
  extIcon,
  fileIconColorClass,
  fileTypeLabel,
  formatBytes,
  formatDateTime,
  isImage,
  isMedia,
  isPdf,
} from '../../utils/nextcloudFile';
import {
  NC_BORDER,
  NC_FOCUS_RING,
  NC_HAIRLINE,
  NC_HOVER,
  NC_SURFACE,
  NC_TEXT,
  NC_TEXT_MUTED,
  NC_TEXT_STRONG,
} from './ncTokens';

/**
 * NextcloudDetailsPanel — painel lateral de detalhes.
 * -----------------------------------------------------------------------------
 * Mostra o que antes só existia atrás de dois cliques (Propriedades, Histórico
 * de versões, quem está editando) sem tirar a lista da frente: o modal de
 * Propriedades continua existindo para o cálculo pesado de pasta (tamanho
 * recursivo, contagem) e para seleção múltipla, e é ele que este painel abre no
 * botão "Propriedades". Aqui ficam só os dados que já estão em memória — nada
 * que exija uma varredura no servidor.
 */

interface NextcloudDetailsPanelProps {
  entries: NextcloudEntry[];
  /** Pasta aberta, usada quando não há nada selecionado. */
  currentPath: string;
  linkedClientName: (entry: NextcloudEntry) => string | null;
  peersFor: (path: string) => EditingPeer[];
  locationOf: (entry: NextcloudEntry) => string;
  onClose: () => void;
  onPreview: (entry: NextcloudEntry) => void;
  onDownload: (entries: NextcloudEntry[]) => void;
  onOpenVersions: (entry: NextcloudEntry) => void;
  onOpenProperties: (entries: NextcloudEntry[]) => void;
  onLinkFolder: (entry: NextcloudEntry) => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className={`border-b py-2.5 last:border-b-0 ${NC_HAIRLINE}`}>
    <span className={`block text-[11px] ${NC_TEXT_MUTED}`}>{label}</span>
    <span className={`mt-0.5 block break-words text-[13px] font-medium ${NC_TEXT}`}>{children}</span>
  </div>
);

export const NextcloudDetailsPanel: React.FC<NextcloudDetailsPanelProps> = ({
  entries,
  currentPath,
  linkedClientName,
  peersFor,
  locationOf,
  onClose,
  onPreview,
  onDownload,
  onOpenVersions,
  onOpenProperties,
  onLinkFolder,
}) => {
  const single = entries.length === 1 ? entries[0] : null;
  const Icon = single ? extIcon(single) : Info;
  const peers = single && !single.isDir ? peersFor(single.path) : [];
  const client = single ? linkedClientName(single) : null;
  const canPreview = Boolean(single && !single.isDir && (isPdf(single) || isImage(single) || isMedia(single)));

  const actionButton = `inline-flex h-9 w-full items-center gap-2 rounded-lg px-3 text-[13px] transition ${NC_TEXT} ${NC_HOVER} ${NC_FOCUS_RING}`;

  return (
    <aside
      aria-label="Detalhes"
      className={`absolute inset-y-0 right-0 z-30 flex w-[300px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl border ${NC_BORDER} ${NC_SURFACE} shadow-xl lg:static lg:z-auto lg:shadow-none`}
    >
      <div className={`flex h-14 shrink-0 items-center justify-between gap-2 border-b px-4 ${NC_BORDER}`}>
        <h3 className={`min-w-0 truncate text-sm font-medium ${NC_TEXT_STRONG}`}>
          {single ? single.name : entries.length > 1 ? `${entries.length} itens selecionados` : 'Detalhes'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar detalhes"
          title="Fechar detalhes"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${NC_TEXT_MUTED} ${NC_HOVER} ${NC_FOCUS_RING}`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {!single ? (
          <div className={`py-8 text-center text-[13px] ${NC_TEXT_MUTED}`}>
            {entries.length > 1 ? (
              <>
                <p>{entries.length} itens selecionados.</p>
                <p className="mt-1 text-xs">Selecione um único item para ver os detalhes completos.</p>
                <button type="button" onClick={() => onOpenProperties(entries)} className={`${actionButton} mt-4 justify-center`}>
                  <Info className="h-4 w-4 text-blue-600" /> Propriedades da seleção
                </button>
              </>
            ) : (
              <>
                <p>Nenhum item selecionado.</p>
                <p className="mt-1 text-xs">Pasta atual: {currentPath || 'Início'}</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className={`mb-4 flex items-center justify-center overflow-hidden rounded-xl border p-3 ${NC_BORDER} ${NC_SURFACE}`}>
              {single.isDir ? (
                <Icon className="h-14 w-14 text-blue-500" />
              ) : isImage(single) || isPdf(single) ? (
                <div className="w-full"><NcThumb entry={single} /></div>
              ) : (
                <Icon className={`h-14 w-14 ${fileIconColorClass(single)}`} />
              )}
            </div>

            {peers.length > 0 && (
              <div className="mb-3">
                <EditingNowBadge peers={peers} />
              </div>
            )}

            <Row label="Tipo">{fileTypeLabel(single)}</Row>
            {!single.isDir && <Row label="Tamanho">{formatBytes(single.size)}</Row>}
            <Row label="Localização">{locationOf(single)}</Row>
            <Row label="Modificado">{formatDateTime(single.mtime)}</Row>
            <Row label="Armazenamento">Nextcloud</Row>
            <Row label="Cliente vinculado">{client || 'Não vinculado'}</Row>

            <div className={`mt-3 border-t pt-3 ${NC_HAIRLINE}`}>
              {canPreview && (
                <button type="button" onClick={() => onPreview(single)} className={actionButton}>
                  <Eye className="h-4 w-4 text-slate-500" /> Visualizar
                </button>
              )}
              {!single.isDir && (
                <button type="button" onClick={() => onOpenVersions(single)} className={actionButton}>
                  <History className="h-4 w-4 text-amber-600" /> Histórico de versões
                </button>
              )}
              {single.isDir && (
                <button type="button" onClick={() => onLinkFolder(single)} className={actionButton}>
                  <UserPlus className="h-4 w-4 text-emerald-600" /> {client ? 'Alterar vínculo' : 'Vincular a cliente'}
                </button>
              )}
              <button type="button" onClick={() => onDownload([single])} className={actionButton}>
                <Download className="h-4 w-4 text-slate-500" /> Baixar{single.isDir ? ' como ZIP' : ''}
              </button>
              <button type="button" onClick={() => onOpenProperties([single])} className={actionButton}>
                <Info className="h-4 w-4 text-blue-600" /> Propriedades
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default NextcloudDetailsPanel;
