// Status bar ligada ao store externo (ver petitionDocStatus.ts): a página muda
// a cada rolagem e SÓ esta barra re-renderiza — a árvore do editor fica parada,
// deixando a thread principal livre para repintar o canvas do documento.

import React from 'react';
import PetitionStatusBar from './PetitionStatusBar';
import { usePetitionDocStatus, type PetitionDocStatusStore } from './petitionDocStatus';

export interface PetitionLiveStatusBarProps {
  store: PetitionDocStatusStore;
  words: number;
  onZoomChange: (zoom: number) => void;
  onLayoutChange: (layout: 'Pages' | 'Continuous') => void;
}

const PetitionLiveStatusBar: React.FC<PetitionLiveStatusBarProps> = ({
  store,
  words,
  onZoomChange,
  onLayoutChange,
}) => {
  const status = usePetitionDocStatus(store);

  return (
    <PetitionStatusBar
      page={status.page}
      pageCount={status.pageCount}
      words={words}
      zoom={status.zoom}
      onZoomChange={onZoomChange}
      layout={status.layout}
      onLayoutChange={onLayoutChange}
    />
  );
};

export default PetitionLiveStatusBar;
