// Status bar do Editor de Petições — estilo Word: página atual/total,
// contagem de palavras, modos de exibição e zoom (slider + presets).
// Substitui a status bar nativa do Syncfusion (ocultada por CSS no módulo).

import React from 'react';
import { BookOpen, ScrollText, Minus, Plus } from 'lucide-react';

export interface PetitionStatusBarProps {
  page: number;
  pageCount: number;
  words: number;
  /** 1 = 100% */
  zoom: number;
  onZoomChange: (zoom: number) => void;
  layout: 'Pages' | 'Continuous';
  onLayoutChange: (layout: 'Pages' | 'Continuous') => void;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

const formatWords = (words: number) =>
  words.toLocaleString('pt-BR');

const PetitionStatusBar: React.FC<PetitionStatusBarProps> = ({
  page,
  pageCount,
  words,
  zoom,
  onZoomChange,
  layout,
  onLayoutChange,
}) => {
  const pct = Math.round(zoom * 100);

  const nudgeZoom = (delta: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((zoom + delta) * 10) / 10));
    onZoomChange(next);
  };

  return (
    <div className="pet-statusbar">
      <div className="pet-statusbar-left">
        <span className="pet-statusbar-item tabular-nums">
          Página {page} de {pageCount}
        </span>
        <span className="pet-statusbar-sep" />
        <span className="pet-statusbar-item tabular-nums">
          {formatWords(words)} {words === 1 ? 'palavra' : 'palavras'}
        </span>
      </div>

      <div className="pet-statusbar-right">
        <div className="pet-statusbar-modes">
          <button
            type="button"
            onClick={() => onLayoutChange('Pages')}
            className={`pet-statusbar-mode-btn ${layout === 'Pages' ? 'is-active' : ''}`}
            title="Modo de páginas"
          >
            <BookOpen className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onLayoutChange('Continuous')}
            className={`pet-statusbar-mode-btn ${layout === 'Continuous' ? 'is-active' : ''}`}
            title="Modo contínuo"
          >
            <ScrollText className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="pet-statusbar-sep" />

        <div className="pet-statusbar-zoom">
          <button
            type="button"
            onClick={() => nudgeZoom(-ZOOM_STEP)}
            className="pet-statusbar-zoom-btn"
            title="Reduzir zoom"
            disabled={zoom <= ZOOM_MIN}
          >
            <Minus className="w-3 h-3" />
          </button>
          <input
            type="range"
            min={ZOOM_MIN * 100}
            max={ZOOM_MAX * 100}
            step={ZOOM_STEP * 100}
            value={pct}
            onChange={(e) => onZoomChange(Number(e.target.value) / 100)}
            className="pet-statusbar-zoom-slider"
            title="Zoom"
          />
          <button
            type="button"
            onClick={() => nudgeZoom(ZOOM_STEP)}
            className="pet-statusbar-zoom-btn"
            title="Aumentar zoom"
            disabled={zoom >= ZOOM_MAX}
          >
            <Plus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(1)}
            className="pet-statusbar-zoom-pct tabular-nums"
            title="Restaurar 100%"
          >
            {pct}%
          </button>
        </div>
      </div>
    </div>
  );
};

export default PetitionStatusBar;
