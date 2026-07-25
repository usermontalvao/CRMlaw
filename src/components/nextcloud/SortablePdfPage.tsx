import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Card arrastável de página do PDF (usado no organizador de páginas).
 * Extraído de NextcloudBrowser (refactor incremental — Fase 5).
 */
export const SortablePdfPage: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-10 opacity-70 scale-[0.98]' : ''}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

export default SortablePdfPage;
