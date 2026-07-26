/**
 * Detecta se a URL atual é a do app dedicado "Editor" (PWA instalável separado
 * do CRM). Fonte única de verdade usada pelo boot (main.tsx), pelo loader
 * dedicado (App.tsx) e pela abertura automática (PetitionEditorWidget).
 *
 * Aceita duas formas:
 *  - CAMINHO próprio `/editor` (installs novos): dá ao PWA um escopo próprio, o
 *    que permite ao navegador abrir ESTE app (e não o CRM) ao seguir um link.
 *  - hash legado `#/editor` (installs antigos): mantido como fallback para não
 *    quebrar quem já instalou o app antes da migração para caminho.
 */
export function isEditorAppLocation(
  pathname: string = window.location.pathname,
  hash: string = window.location.hash,
): boolean {
  return pathname === '/editor' || pathname === '/editor/' || hash.startsWith('#/editor');
}
