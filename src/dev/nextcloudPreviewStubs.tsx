/**
 * Dublês para a bancada visual do explorador Nextcloud (`nextcloud-preview.html`).
 * -----------------------------------------------------------------------------
 * Servem SÓ para olhar a interface com dados previsíveis, sem servidor e sem
 * login. Não entram no bundle da aplicação: só o `vite.preview.config.ts` os
 * coloca no lugar dos módulos reais.
 */
import React from 'react';
import type { NextcloudChangeEvent, NextcloudEntry } from '../services/nextcloud.service';

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();

const TREE: Record<string, NextcloudEntry[]> = {
  '': [
    { name: 'Clientes', path: 'Clientes', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(0) },
    { name: 'Processos', path: 'Processos', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(2) },
    { name: 'Modelos', path: 'Modelos', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(9) },
    { name: 'Financeiro', path: 'Financeiro', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(14) },
    { name: 'Manual do escritório.pdf', path: 'Manual do escritório.pdf', isDir: false, size: 2_400_000, mime: 'application/pdf', mtime: iso(1) },
  ],
  Clientes: [
    { name: 'Família e sucessões', path: 'Clientes/Família e sucessões', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(0) },
    { name: 'Empresarial', path: 'Clientes/Empresarial', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(3) },
    { name: 'Trabalhista', path: 'Clientes/Trabalhista', isDir: true, size: 0, mime: 'httpd/unix-directory', mtime: iso(6) },
    { name: 'Contrato social — Ápice Ltda.pdf', path: 'Clientes/Contrato social — Ápice Ltda.pdf', isDir: false, size: 2_400_000, mime: 'application/pdf', mtime: iso(0) },
    { name: 'Procuração — João Mendes.docx', path: 'Clientes/Procuração — João Mendes.docx', isDir: false, size: 186_000, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mtime: iso(1) },
    { name: 'Documentos pessoais.zip', path: 'Clientes/Documentos pessoais.zip', isDir: false, size: 18_700_000, mime: 'application/zip', mtime: iso(2) },
    { name: 'Contestação revisada.pdf', path: 'Clientes/Contestação revisada.pdf', isDir: false, size: 4_100_000, mime: 'application/pdf', mtime: iso(4) },
    { name: 'Fachada do escritório.jpg', path: 'Clientes/Fachada do escritório.jpg', isDir: false, size: 820_000, mime: 'image/jpeg', mtime: iso(8) },
    { name: 'Notas da audiência.txt', path: 'Clientes/Notas da audiência.txt', isDir: false, size: 3_200, mime: 'text/plain', mtime: iso(11) },
  ],
};

export const nextcloudService = {
  ping: async () => ({ ok: true, root: '/' }),
  list: async (path = '') => TREE[path] ?? [],
  search: async (query: string, path = '') => {
    const term = query.toLocaleLowerCase('pt-BR');
    return Object.values(TREE).flat().filter((entry) =>
      entry.path.startsWith(path) && entry.name.toLocaleLowerCase('pt-BR').includes(term));
  },
  readFile: async () => new Blob([new Uint8Array()]),
  stat: async () => ({ exists: false }),
  writeFile: async () => ({ etag: null }),
  writeFileWithProgress: async () => ({ etag: null }),
  writeFileVerified: async () => ({ etag: null }),
  makeFolder: async () => {},
  remove: async () => {},
  move: async () => {},
  copy: async () => {},
  listVersions: async () => [],
  restoreVersion: async () => {},
  readVersion: async () => new Blob([new Uint8Array()]),
  getFolderLinks: async () => ({ Clientes: 'c1', 'Clientes/Empresarial': 'c2' }),
  linkFolder: async () => {},
  unlinkFolder: async () => {},
  subscribeFileChanges: () => () => {},
  recentChanges: async (): Promise<NextcloudChangeEvent[]> => [
    ev('OCP\\Files\\Events\\Node\\NodeWrittenEvent', 'Clientes/Contestação revisada.pdf', 'Marina Costa', 4),
    ev('OCP\\Files\\Events\\Node\\NodeCreatedEvent', 'Clientes/Procuração — João Mendes.docx', 'Pedro', 90),
    ev('OCP\\Files\\Events\\Node\\NodeRenamedEvent', 'Clientes/Empresarial', 'Pedro', 240),
    ev('OCP\\Files\\Events\\Node\\NodeDeletedEvent', 'Modelos/Rascunho antigo.docx', 'Marina Costa', 900),
    ev('OCP\\Files\\Events\\Node\\NodeCreatedEvent', 'Financeiro/Recibo 2026-07.pdf', 'Pedro', 3000),
  ],
};

let evSeq = 0;
function ev(eventClass: string, path: string, actor: string, minutesAgo: number): NextcloudChangeEvent {
  evSeq += 1;
  return {
    id: `ev-${evSeq}`,
    eventClass,
    actorUid: actor.toLowerCase(),
    actorName: actor,
    nodePath: path,
    sourcePath: null,
    targetPath: null,
    affectedDirectory: path.split('/').slice(0, -1).join('/'),
    nodeId: evSeq,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

export class NextcloudServiceError extends Error {}
export class NextcloudConflictError extends NextcloudServiceError {}
export function getNextcloudErrorMessage(error: unknown, action: string): string {
  return `Não foi possível ${action}: ${error instanceof Error ? error.message : 'erro'}`;
}
export type { NextcloudChangeEvent, NextcloudEntry };

/* --- contextos --- */

export const useAuth = () => ({
  user: { id: 'preview-user', email: 'pedro@advcuiaba.com' },
  profile: { id: 'preview-user', full_name: 'Pedro (prévia)' },
  loading: false,
});
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;

export const useNavigation = () => ({ moduleParams: {}, clearModuleParams: () => {} });
export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;

/* --- serviços auxiliares --- */

export const clientService = {
  listClients: async () => [
    { id: 'c1', full_name: 'Ápice Ltda.' },
    { id: 'c2', full_name: 'Ribeiro & Filhos' },
    { id: 'c3', full_name: 'João Mendes' },
  ],
};

/** Presença: sem servidor, uma pessoa fixa editando, para ver o aviso na lista. */
export const subscribeNextcloudPresence = (
  listener: (list: Array<{ path: string; userId: string; userName: string; typing: boolean; since: number }>) => void,
) => {
  listener([{ path: 'Clientes/Contestação revisada.pdf', userId: 'outro', userName: 'Marina Costa', typing: true, since: Date.now() }]);
  return () => {};
};
export const startEditingPresence = () => ({ setTyping: () => {}, stop: () => {} });

export const isCollabEnabled = () => false;
