import React from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Lightbox/galeria de mídia da thread. Renderiza num portal para `document.body`
 * para escapar do containing block do widget embutido (o painel usa transform +
 * overflow-hidden, que prenderiam o `fixed` dentro da thread). Fecha por clique
 * fora, X e ESC (o handler de teclado é registrado por quem controla o estado).
 */
export const WaLightbox: React.FC<{
  image: string;
  images: string[];
  onClose: () => void;
  onNavigate: (url: string) => void;
}> = ({ image, images, onClose, onNavigate }) => {
  const idx = images.indexOf(image);
  const hasGallery = idx >= 0 && images.length > 1;
  return createPortal(
    <div className="fixed inset-0 z-[100000] bg-black/85 flex items-center justify-center p-6" style={{ backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }} onClick={onClose}>
      <img src={image} alt="" className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
      <button onClick={onClose} className="absolute top-5 right-5 h-10 w-10 rounded-full bg-black/60 hover:bg-black/90 text-white flex items-center justify-center ring-1 ring-white/20 transition" title="Fechar"><X size={22} /></button>
      {hasGallery && (
        <>
          <button
            onClick={e => { e.stopPropagation(); onNavigate(images[Math.max(idx - 1, 0)]); }}
            disabled={idx === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
            title="Imagem anterior">
            <ChevronLeft size={28} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onNavigate(images[Math.min(idx + 1, images.length - 1)]); }}
            disabled={idx === images.length - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-black/50 hover:bg-black/80 text-white flex items-center justify-center ring-1 ring-white/20 transition disabled:opacity-30 disabled:cursor-default"
            title="Próxima imagem">
            <ChevronRight size={28} />
          </button>
          <span className="absolute top-6 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-[12px] font-semibold ring-1 ring-white/20">
            {idx + 1} / {images.length}
          </span>
        </>
      )}
    </div>,
    document.body,
  );
};
