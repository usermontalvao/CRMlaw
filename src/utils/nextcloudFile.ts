import {
  Folder,
  File as FileIcon,
  FileText,
  FileType2,
  Image as ImageIcon,
  Film,
  Music,
} from 'lucide-react';
import type { NextcloudEntry } from '../services/nextcloud.service';

/**
 * utils/nextcloudFile
 * -----------------------------------------------------------------------------
 * Regras de classificação de arquivos do módulo Nextcloud — FONTE ÚNICA de
 * verdade, compartilhada entre a lista, a grade, a árvore lateral e os
 * componentes extraídos (ex.: NcThumb). Funções puras (sem estado/DOM).
 */

export const isDocx = (e: NextcloudEntry) =>
  e.mime.includes('word') || /\.docx?$/i.test(e.name);
export const isPdf = (e: NextcloudEntry) =>
  e.mime.includes('pdf') || /\.pdf$/i.test(e.name);
export const isImage = (e: NextcloudEntry) =>
  e.mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(e.name);
export const isVideo = (e: NextcloudEntry) =>
  e.mime.startsWith('video/') || /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i.test(e.name);
export const isAudio = (e: NextcloudEntry) =>
  e.mime.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(e.name);
export const isMedia = (e: NextcloudEntry) => isVideo(e) || isAudio(e);
export const isTextFile = (e: NextcloudEntry) =>
  e.mime.startsWith('text/')
  || e.mime === 'application/json'
  || e.mime === 'application/xml'
  || /\.(txt|md|log|csv|json|xml|yaml|yml)$/i.test(e.name);

/** Nome base (sem extensão) para compor nomes de arquivos derivados. */
export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Extensão em MAIÚSCULAS (sem o ponto) ou `null`. Mantém a semântica original
 *  usada em toda a UI (ex.: badges de tipo, rótulos). */
export function fileExtension(name: string): string | null {
  const match = name.trim().match(/\.([a-z0-9]{1,10})$/i);
  return match ? match[1].toUpperCase() : null;
}

export function fileTypeLabel(entry: NextcloudEntry): string {
  if (entry.isDir) return 'Pasta de arquivos';
  if (isPdf(entry)) return 'Documento PDF';
  if (isDocx(entry)) return 'Documento do Microsoft Word';
  if (isImage(entry)) return 'Arquivo de imagem';
  if (isVideo(entry)) return 'Arquivo de vídeo';
  if (isAudio(entry)) return 'Arquivo de áudio';
  if (isTextFile(entry)) return 'Documento de texto';
  const extension = fileExtension(entry.name);
  return extension ? `Arquivo ${extension.toUpperCase()}` : 'Arquivo';
}

/** Ícone (componente lucide) representativo do tipo do arquivo. */
export function extIcon(entry: NextcloudEntry) {
  if (entry.isDir) return Folder;
  if (isImage(entry)) return ImageIcon;
  if (isVideo(entry)) return Film;
  if (isAudio(entry)) return Music;
  if (isPdf(entry) || isTextFile(entry)) return FileText;
  if (isDocx(entry)) return FileType2;
  return FileIcon;
}

/** Cor padronizada para o ícone em todas as superfícies do Nextcloud. */
export function fileIconColorClass(entry: NextcloudEntry): string {
  if (entry.isDir) return 'text-blue-500';
  if (isPdf(entry)) return 'text-red-500';
  if (isDocx(entry)) return 'text-blue-600';
  if (isImage(entry)) return 'text-violet-500';
  if (isVideo(entry)) return 'text-fuchsia-500';
  if (isAudio(entry)) return 'text-amber-500';
  if (isTextFile(entry)) return 'text-slate-500';
  return 'text-gray-400';
}

/**
 * Tamanho legível. Movido do NextcloudBrowser para cá quando o painel lateral
 * de detalhes passou a precisar da MESMA conta que a lista — duas versões
 * arredondando diferente mostrariam tamanhos distintos para o mesmo arquivo.
 */
export function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Data/hora por extenso (propriedades e painel de detalhes). */
export function formatDateTime(mtime: string | null): string {
  if (!mtime) return 'Não informado';
  const date = new Date(mtime);
  if (isNaN(date.getTime())) return 'Não informado';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
