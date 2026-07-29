/**
 * Estado da status bar (página atual, total, zoom, modo) FORA do React.
 *
 * Por que não é `useState` no PetitionEditorModule: o Syncfusion dispara
 * `viewChange` a cada evento de rolagem, e o número da página muda várias vezes
 * por segundo numa rolagem rápida. Guardando isso em estado do módulo, cada
 * troca de página re-renderizava a árvore inteira do editor (faixa de opções,
 * biblioteca lateral, chat da IA, modais) — trabalho pesado na MESMA thread que
 * precisa repintar o canvas da página. Frame perdido ali é faixa em branco na
 * borda que está entrando na tela.
 *
 * Com um store externo, só a status bar re-renderiza; o resto da árvore nem fica
 * sabendo. Ver `PetitionLiveStatusBar`.
 */
import { useSyncExternalStore } from 'react';

export type PetitionDocStatus = {
  page: number;
  pageCount: number;
  zoom: number;
  layout: 'Pages' | 'Continuous';
};

export type PetitionDocStatusStore = {
  get: () => PetitionDocStatus;
  set: (next: PetitionDocStatus) => void;
  subscribe: (listener: () => void) => () => void;
};

const INITIAL: PetitionDocStatus = { page: 1, pageCount: 1, zoom: 1, layout: 'Pages' };

export const createPetitionDocStatusStore = (): PetitionDocStatusStore => {
  let value: PetitionDocStatus = INITIAL;
  const listeners = new Set<() => void>();

  return {
    get: () => value,
    set: (next) => {
      if (
        next.page === value.page
        && next.pageCount === value.pageCount
        && next.zoom === value.zoom
        && next.layout === value.layout
      ) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
};

export const usePetitionDocStatus = (store: PetitionDocStatusStore): PetitionDocStatus =>
  useSyncExternalStore(store.subscribe, store.get, store.get);
