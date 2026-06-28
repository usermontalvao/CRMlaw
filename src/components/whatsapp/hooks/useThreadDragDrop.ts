import { useRef, useState } from 'react';

/**
 * Drag and drop de arquivos na thread (estilo WhatsApp Web). Concentra o estado
 * de UI do overlay (`dragOver`) e a contagem enter/leave que evita piscar ao
 * cruzar elementos filhos. O envio de mídia em si (sendFile, staging, retry) vive
 * em useWaComposer — aqui só entregamos os arquivos soltos via `onFiles`.
 *
 * @param enabled  permite o drop (ex.: há conversa aberta e não está editando).
 * @param onFiles  recebe os arquivos soltos para o fluxo de envio do composer.
 */
export function useThreadDragDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const onDragEnter = (e: React.DragEvent) => {
    if (!enabled) return;
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
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
    onFiles(Array.from(e.dataTransfer?.files || []));
  };

  return { dragOver, dragProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
