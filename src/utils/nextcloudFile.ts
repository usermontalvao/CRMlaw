import {
  Folder,
  File as FileIcon,
  FileText,
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
  if (isDocx(entry) || isPdf(entry) || isTextFile(entry)) return FileText;
  return FileIcon;
}
