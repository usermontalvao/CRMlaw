import { useRef, useState } from 'react';

/**
 * Tipo MIME interno do arrasto que sai da janela de arquivos do Nextcloud.
 *
 * Arrastar um arquivo QUE ESTÁ NO SERVIDOR não carrega bytes: o navegador não
 * tem o arquivo em mãos, só o endereço dele. Então o arrasto leva o caminho, e
 * quem recebe é que baixa e envia. Ver `nextcloudClientWindow.tsx`.
 */
export const NEXTCLOUD_DRAG_MIME = 'application/x-jurius-nextcloud-file';

export interface NextcloudDragFile {
  path: string;
  name: string;
  mime: string;
}

/** O arrasto carrega a SELEÇÃO inteira — arrastar três arquivos manda três. */
export interface NextcloudDragPayload {
  files: NextcloudDragFile[];
}

/** Lê o arrasto do Nextcloud, se for isso que está vindo. */
export function readNextcloudDrag(dt: DataTransfer | null): NextcloudDragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(NEXTCLOUD_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { files?: unknown };
    const lista = Array.isArray(parsed?.files) ? parsed.files : [];
    const files = lista
      .map(item => item as Partial<NextcloudDragFile>)
      .filter(item => typeof item?.path === 'string' && !!item.path)
      .map(item => ({ path: item.path as string, name: String(item.name || ''), mime: String(item.mime || '') }));
    return files.length ? { files } : null;
  } catch {
    return null;
  }
}

/**
 * Drag and drop de arquivos na thread (estilo WhatsApp Web). Concentra o estado
 * de UI do overlay (`dragOver`) e a contagem enter/leave que evita piscar ao
 * cruzar elementos filhos. O envio de mídia em si (sendFile, staging, retry) vive
 * em useWaComposer — aqui só entregamos os arquivos soltos via `onFiles`.
 *
 * Duas origens são aceitas, e o overlay é o mesmo para as duas:
 *   1. arquivos do computador (`dataTransfer.files`);
 *   2. um arquivo arrastado da janela do Nextcloud do cliente — aí não vêm
 *      bytes, vem o caminho, e quem baixa é `onNextcloudFile`.
 *
 * @param enabled          permite o drop (ex.: há conversa aberta e não está editando).
 * @param onFiles          recebe os arquivos soltos para o fluxo de envio do composer.
 * @param onNextcloudFile  recebe o arquivo arrastado da janela do Nextcloud.
 */
export function useThreadDragDrop(
  enabled: boolean,
  onFiles: (files: File[]) => void,
  onNextcloudFile?: (payload: NextcloudDragPayload) => void,
) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const aceita = (dt: DataTransfer | null | undefined) => {
    const types = Array.from(dt?.types || []);
    return types.includes('Files') || (!!onNextcloudFile && types.includes(NEXTCLOUD_DRAG_MIME));
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!enabled) return;
    if (!aceita(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!dragOver) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (e: React.DragEvent) => {
    if (!dragOver) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!enabled) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);
    const doNextcloud = onNextcloudFile ? readNextcloudDrag(e.dataTransfer) : null;
    if (doNextcloud) { onNextcloudFile?.(doNextcloud); return; }
    onFiles(Array.from(e.dataTransfer?.files || []));
  };

  return { dragOver, dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
