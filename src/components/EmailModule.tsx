import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import {
  Inbox, Send, FileText, Flame, Trash2, Search, Paperclip, Reply, Forward,
  Mail, MailOpen, RefreshCw, PenSquare, Loader2, AlertOctagon, RotateCcw, ReplyAll,
  Settings, Type, Printer, PenLine, SlidersHorizontal, ShieldCheck, Plus, X,
  Bold, Italic, Underline, List, ListOrdered, Link2,
  Strikethrough, AlignLeft, AlignCenter, AlignRight, Quote, RemoveFormatting, Palette, ChevronDown,
  AlertCircle, ChevronLeft, Keyboard, ImageOff, Star, Ban, Sparkles, User,
} from 'lucide-react';
import { emailService } from '../services/email.service';
import { aiService } from '../services/ai.service';
import { clientService } from '../services/client.service';
import { userNotificationService } from '../services/userNotification.service';
import { dashboardPreferencesService } from '../services/dashboardPreferences.service';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../config/supabase';
import type { EmailFolder, EmailMessage, EmailSignature, SendEmailDTO, EmailSpamRule, SpamRuleKind, SpamRuleMatch, EmailSearchFilters } from '../types/email.types';
import type { Client } from '../types/client.types';
import { Modal, ModalBody, ModalFooter, Button, Input, Label } from './ui';
import { resolveFolder } from '../utils/email.transitions';

const FOLDERS: { key: EmailFolder; label: string; Icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Caixa de entrada', Icon: Inbox },
  { key: 'starred', label: 'Com estrela', Icon: Star },
  { key: 'drafts', label: 'Rascunhos', Icon: FileText },
  { key: 'sent', label: 'Enviados', Icon: Send },
  { key: 'spam', label: 'Spam', Icon: Flame },
  { key: 'trash', label: 'Lixeira', Icon: Trash2 },
];

const MATCH_LABEL: Record<SpamRuleMatch, string> = {
  address: 'endereço',
  domain: 'domínio',
  from_regex: 'remetente~',
  subject_regex: 'assunto~',
  body_regex: 'corpo~',
};

const LS_FOLDERS_W = 'email:foldersW';
const LS_LIST_W = 'email:listW';
const LS_PREFS = 'email:prefs';
const LS_ALLOWED_IMAGE_SENDERS = 'email:allowedImageSenders';
const LS_COMPOSE_UI = 'email:composeUi';

// Memória de "imagens liberadas" por mensagem. Uma vez que o usuário clica em
// "Exibir imagens" num e-mail, não faz sentido bloquear de novo toda vez que ele
// reabre — guardamos o id da mensagem (persistido entre sessões, com teto p/ não
// crescer sem limite).
const allowedImageSenders: Set<string> = (() => {
  try {
    const raw = localStorage.getItem(LS_ALLOWED_IMAGE_SENDERS);
    return new Set<string>(raw ? JSON.parse(raw) : []);
  } catch { return new Set<string>(); }
})();
function senderImageKey(sender?: string | null): string | null {
  if (!sender) return null;
  const email = addressOf(sender).trim().toLowerCase();
  return email || null;
}
function rememberAllowedImageSender(sender?: string | null) {
  const key = senderImageKey(sender);
  if (!key || allowedImageSenders.has(key)) return;
  allowedImageSenders.add(key);
  try { localStorage.setItem(LS_ALLOWED_IMAGE_SENDERS, JSON.stringify([...allowedImageSenders].slice(-800))); } catch { /* noop */ }
}

// MAILBOX_ADDRESS removido — endereço do usuário vem do AuthContext (user.email)

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Extrai o endereço de um item que pode vir como "Nome <email>" ou só "email".
function addressOf(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim();
}
function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(addressOf(raw).toLowerCase());
}
// Quebra uma lista "a@x.com, Nome <b@y.com>; c@z.com" em endereços individuais.
function parseRecipients(s: string): string[] {
  return s.split(/[,;]+/).map((e) => e.trim()).filter(Boolean);
}
// Lista de endereços (lowercased) a partir de um campo to/cc, p/ montar Responder a todos.
function extractAddresses(text: string | null): string[] {
  if (!text) return [];
  return parseRecipients(text).map((p) => addressOf(p).toLowerCase()).filter(Boolean);
}

interface EmailPrefs {
  perPage: number;
  autoMarkRead: boolean;
}

interface EmailComposeUiPrefs {
  activeDraftId: string | null;
  composeMinimized: boolean;
}

const EMPTY_EMAIL_FILTERS: EmailSearchFilters = {
  from: '',
  to: '',
  subject: '',
  hasAttachments: false,
  starredOnly: false,
  dateFrom: '',
  dateTo: '',
};

const DEFAULT_PREFS: EmailPrefs = { perPage: 50, autoMarkRead: true };

function loadPrefs(): EmailPrefs {
  try {
    const raw = localStorage.getItem(LS_PREFS);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadComposeUiPrefs(): EmailComposeUiPrefs {
  try {
    const raw = localStorage.getItem(LS_COMPOSE_UI);
    if (!raw) return { activeDraftId: null, composeMinimized: false };
    const parsed = JSON.parse(raw);
    return {
      activeDraftId: typeof parsed?.activeDraftId === 'string' ? parsed.activeDraftId : null,
      composeMinimized: !!parsed?.composeMinimized,
    };
  } catch {
    return { activeDraftId: null, composeMinimized: false };
  }
}

const EMAIL_SELECT_ALL_EVENT = 'email-select-all-shortcut';

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function senderName(m: EmailMessage): string {
  const t = m.direction === 'outbound' ? m.to_text : (m.from_text || m.from_address);
  if (!t) return '(sem remetente)';
  const match = t.match(/^\s*"?([^"<]+?)"?\s*</);
  return (match ? match[1] : t).trim();
}

// Prévia do corpo (snippet) p/ a lista. Prefere texto puro; se só houver HTML,
// remove tags de forma leve (regex, sem montar DOM por item) e colapsa espaços.
function snippet(m: EmailMessage, max = 100): string {
  let s = m.body_text?.trim() || '';
  if (!s && m.body_html) {
    s = m.body_html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Agrupa a lista (já ordenada desc) por faixa de data, com cabeçalho por grupo.
function dateBucket(iso: string | null): { key: string; label: string } {
  if (!iso) return { key: 'sem-data', label: 'Sem data' };
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays <= 0) return { key: 'hoje', label: 'Hoje' };
  if (diffDays === 1) return { key: 'ontem', label: 'Ontem' };
  if (diffDays < 7) return { key: 'semana', label: 'Esta semana' };
  if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) return { key: 'mes', label: 'Este mês' };
  const sameYear = d.getFullYear() === now.getFullYear();
  const label = d.toLocaleDateString('pt-BR', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  return { key: `m-${d.getFullYear()}-${d.getMonth()}`, label: label.charAt(0).toUpperCase() + label.slice(1) };
}

// Paleta quente (sem azul, alinhada à marca) p/ avatares da lista/leitura.
const AVATAR_COLORS = [
  'bg-amber-100 text-amber-800', 'bg-orange-100 text-orange-800', 'bg-rose-100 text-rose-800',
  'bg-emerald-100 text-emerald-800', 'bg-stone-200 text-stone-700', 'bg-yellow-100 text-yellow-800',
  'bg-red-100 text-red-800', 'bg-teal-100 text-teal-800',
];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface ComposeAttachment {
  filename: string;
  content: string; // base64 (sem prefixo data:)
  contentType?: string;
  size: number;
}

interface ComposeState {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  showCc: boolean;
  inReplyTo?: string;
  threadKey?: string;
  clientId?: string;
  attachments: ComposeAttachment[];
}

interface ComposeWarning {
  id: string;
  message: string;
}

const emptyCompose: ComposeState = {
  to: '', cc: '', bcc: '', subject: '', bodyHtml: '', showCc: false, attachments: [],
};

// Assinatura dos campos relevantes do compose — usada p/ detectar "sujou"
// (mudou desde que abriu) e disparar o autosave do rascunho.
function composeKey(c: ComposeState): string {
  return [c.to, c.cc, c.bcc, c.subject, c.bodyHtml].join('');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function normalizeComposeText(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function getComposeWarnings(compose: ComposeState, selected: EmailMessage | null, userEmail: string | null): ComposeWarning[] {
  const warnings: ComposeWarning[] = [];
  const plain = normalizeComposeText(compose.bodyHtml).toLocaleLowerCase('pt-BR');
  const allRecipients = [...parseRecipients(compose.to), ...parseRecipients(compose.cc), ...parseRecipients(compose.bcc)].map((item) => addressOf(item).toLowerCase());
  const informalHits = ['vc', 'vcs', 'kd', 'pq', 'blz', 'mano', 'amigo', 'amiguinho'].filter((token) => new RegExp(`\\b${token}\\b`, 'i').test(plain));

  if (/\banex(a|o|ei|ando|ado|amos)\b|\bem anexo\b|\bsegue anexo\b/i.test(plain) && compose.attachments.length === 0) {
    warnings.push({ id: 'missing-attachment', message: 'Você mencionou anexo, mas não há arquivo anexado.' });
  }
  if (informalHits.length >= 2) {
    warnings.push({ id: 'informal-tone', message: 'O texto parece informal demais para e-mail profissional.' });
  }
  if (compose.inReplyTo && selected?.from_address) {
    const expected = selected.from_address.toLowerCase();
    const self = (userEmail || '').toLowerCase();
    if (!allRecipients.includes(expected) || (self && allRecipients.length === 1 && allRecipients[0] === self)) {
      warnings.push({ id: 'reply-recipient', message: 'Confira o destinatário: a resposta pode não estar indo para o remetente original.' });
    }
  }

  return warnings;
}

// Assinatura deve ser um FRAGMENTO inline. Se o usuário colar um documento HTML
// completo (DOCTYPE/<html>/<head>/<body>), extrai só o conteúdo do <body> e
// descarta a moldura de página — senão o wrapper (background/padding/centralização)
// quebra o layout do compose e vira um "card no meio".
function stripHtmlDocument(html: string): string {
  let s = html;
  const bodyMatch = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) s = bodyMatch[1];
  return s
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)[^>]*>/gi, '')
    .replace(/<title[\s\S]*?<\/title>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .trim();
}

function sigToHtml(sig: EmailSignature | null): string {
  if (!sig) return '';
  if (sig.signature_html?.trim()) return stripHtmlDocument(sig.signature_html);
  if (sig.signature_text?.trim()) return `<div>${escapeHtml(sig.signature_text).replace(/\n/g, '<br>')}</div>`;
  return '';
}

type SpellIssue = {
  id: string;
  word: string;
  matchText: string;
  label: string;
  ignoreKey: string;
  suggestions: string[];
};

const SPELLCHECK_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/syncfusion-proxy/SpellCheckByPage`;

async function checkTextSpelling(text: string, signal?: AbortSignal): Promise<SpellIssue[]> {
  const normalized = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/gi, ' ')
    .replace(/\b\d[\d().\-\/\s]{5,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);

  if (!normalized || normalized.length < 3) return [];

  const resp = await fetch(SPELLCHECK_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TexttoCheck: normalized }),
    signal,
  });
  if (!resp.ok) throw new Error(`SpellCheckByPage ${resp.status}`);

  const data = await resp.json();
  const rows = Array.isArray(data?.SpellCollection) ? data.SpellCollection : [];
  const seen = new Set<string>();
  const issues: SpellIssue[] = [];

  for (const row of rows) {
    if (!row?.HasSpellError || typeof row?.Text !== 'string') continue;
    const word = String(row.Text).trim();
    const key = word.toLocaleLowerCase('pt-BR');
    if (!word || seen.has(key)) continue;
    seen.add(key);
    issues.push({
      id: `spell:${key}`,
      word,
      matchText: word,
      label: `Ortografia: ${word}`,
      ignoreKey: `spell:${key}`,
      suggestions: Array.isArray(row.Suggestions)
        ? row.Suggestions.filter((s: unknown) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [],
    });
    if (issues.length >= 8) break;
  }

  return issues;
}

const SPELL_MARK_ATTR = 'data-email-spell-error';
const SPELL_MARK_ID_ATTR = 'data-email-spell-id';
const SIGNATURE_ATTR = 'data-signature';
const SIGNATURE_DELETE_ATTR = 'data-signature-delete';
const SIGNATURE_DELETE_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;

function buildSignatureBlockHtml(signatureHtml: string): string {
  return `<p><br></p><div ${SIGNATURE_ATTR} contenteditable="false" spellcheck="false" style="position:relative;border-top:1px solid #fed7aa;padding-top:14px;margin-top:10px;user-select:none;cursor:default"><button ${SIGNATURE_DELETE_ATTR} type="button" title="Remover assinatura desta mensagem" style="position:absolute;top:-13px;right:0;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #fdba74;border-radius:9999px;background:#fff7ed;color:#f97316;box-shadow:0 4px 10px rgba(249,115,22,.16);cursor:pointer">${SIGNATURE_DELETE_ICON}</button>${signatureHtml}</div>`;
}
const COMMON_EMAIL_SHORTHANDS: Record<string, string[]> = {
  kd: ['cadê', 'onde está'],
  pq: ['porque', 'por que'],
  vc: ['você'],
  vcs: ['vocês'],
  tb: ['também'],
  qdo: ['quando'],
  msg: ['mensagem'],
};
const REPEATED_ENDING_ALLOWLIST = new Set(['voo', 'enjoo']);

function buildLocalTextIssues(text: string): SpellIssue[] {
  const issues: SpellIssue[] = [];
  const seen = new Set<string>();
  const repetitionRe = /\b([A-Za-zÀ-ÿ]+)\b(?:\s+\1\b)+/gi;
  const wordRe = /\b[A-Za-zÀ-ÿ]{2,}\b/g;
  let match: RegExpExecArray | null;

  while ((match = repetitionRe.exec(text)) !== null) {
    const phrase = match[0].replace(/\s+/g, ' ').trim();
    const word = match[1].trim();
    const normalizedPhrase = phrase.toLocaleLowerCase('pt-BR');
    if (!phrase || !word || seen.has(normalizedPhrase)) continue;
    seen.add(normalizedPhrase);

    issues.push({
      id: `repeat:${normalizedPhrase}`,
      word: phrase,
      matchText: phrase,
      label: `Repetição: ${phrase}`,
      ignoreKey: `repeat:${normalizedPhrase}`,
      suggestions: [word],
    });
  }

  while ((match = wordRe.exec(text)) !== null) {
    const original = match[0];
    const normalized = original.toLocaleLowerCase('pt-BR');
    if (seen.has(`word:${normalized}`)) continue;

    const shorthandSuggestions = COMMON_EMAIL_SHORTHANDS[normalized];
    if (shorthandSuggestions?.length) {
      seen.add(`word:${normalized}`);
      issues.push({
        id: `shorthand:${normalized}`,
        word: original,
        matchText: original,
        label: `Abreviação informal: ${original}`,
        ignoreKey: `shorthand:${normalized}`,
        suggestions: shorthandSuggestions,
      });
      continue;
    }

    const repeatedEndingMatch = normalized.match(/^(.*?)([a-zà-ÿ])\2$/i);
    if (!repeatedEndingMatch) continue;
    if (REPEATED_ENDING_ALLOWLIST.has(normalized)) continue;

    const shortened = repeatedEndingMatch[1] + repeatedEndingMatch[2];
    if (shortened.length < 3) continue;

    seen.add(`word:${normalized}`);
    issues.push({
      id: `ending:${normalized}`,
      word: original,
      matchText: original,
      label: `Possível letra repetida: ${original}`,
      ignoreKey: `ending:${normalized}`,
      suggestions: [shortened],
    });
  }

  return issues;
}
function unwrapSpellMarkers(root: ParentNode): void {
  root.querySelectorAll(`[${SPELL_MARK_ATTR}]`).forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

function getEditorCleanHtml(root: HTMLDivElement): string {
  const clone = root.cloneNode(true) as HTMLDivElement;
  unwrapSpellMarkers(clone);
  clone.querySelectorAll(`[${SIGNATURE_DELETE_ATTR}]`).forEach((el) => el.remove());
  return clone.innerHTML;
}

function isNodeInsideSignature(root: HTMLElement, node: Node | null): boolean {
  if (!node) return false;
  const base = node instanceof Element ? node : node.parentElement;
  return !!base?.closest?.(`[${SIGNATURE_ATTR}]`) && root.contains(base);
}

function placeCaretBeforeSignature(root: HTMLElement): void {
  const signature = root.querySelector(`[${SIGNATURE_ATTR}]`);
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();

  if (signature && signature.parentNode) {
    range.setStartBefore(signature);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaretAtEditableStart(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const topLevelNodes = Array.from(root.childNodes);
  const firstEditableNode = topLevelNodes.find((node) => {
    if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim();
    if (!(node instanceof HTMLElement)) return false;
    return !node.hasAttribute(SIGNATURE_ATTR);
  });

  if (firstEditableNode) {
    range.setStart(firstEditableNode, 0);
  } else {
    range.selectNodeContents(root);
  }

  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function keepSelectionOutOfSignature(root: HTMLElement): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return;
  if (!isNodeInsideSignature(root, range.startContainer) && !isNodeInsideSignature(root, range.endContainer)) return;
  placeCaretBeforeSignature(root);
}

function hasSignatureBlock(root: ParentNode | null): boolean {
  return !!root?.querySelector?.(`[${SIGNATURE_ATTR}]`);
}

function captureSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  const startRange = document.createRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = document.createRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function restoreSelectionOffsets(root: HTMLElement, saved: { start: number; end: number } | null): void {
  if (!saved) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let startNode: Node | null = null;
  let endNode: Node | null = null;
  let startOffset = 0;
  let endOffset = 0;
  let count = 0;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const len = node.textContent?.length ?? 0;
    if (!startNode && saved.start <= count + len) {
      startNode = node;
      startOffset = Math.max(0, saved.start - count);
    }
    if (!endNode && saved.end <= count + len) {
      endNode = node;
      endOffset = Math.max(0, saved.end - count);
      break;
    }
    count += len;
  }

  if (!startNode || !endNode) {
    range.selectNodeContents(root);
    range.collapse(false);
  } else {
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
  }

  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

function applySpellMarkers(root: HTMLDivElement, issues: SpellIssue[]): void {
  unwrapSpellMarkers(root);
  if (!issues.length) return;

  const orderedIssues = [...issues]
    .filter((issue) => issue.matchText.trim())
    .sort((a, b) => b.matchText.length - a.matchText.length);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.nodeValue?.trim()) continue;
    textNodes.push(node);
  }

  for (const node of textNodes) {
    const text = node.nodeValue ?? '';
    const lower = text.toLocaleLowerCase('pt-BR');
    let cursor = 0;
    let hasMarkedWord = false;
    const frag = document.createDocumentFragment();

    while (cursor < text.length) {
      let nextIssue: SpellIssue | null = null;
      let nextIndex = -1;

      for (const issue of orderedIssues) {
        const idx = lower.indexOf(issue.matchText.toLocaleLowerCase('pt-BR'), cursor);
        if (idx === -1) continue;
        if (nextIndex === -1 || idx < nextIndex) {
          nextIndex = idx;
          nextIssue = issue;
          if (idx === cursor) break;
        }
      }

      if (!nextIssue || nextIndex === -1) break;

      hasMarkedWord = true;
      if (nextIndex > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, nextIndex)));
      }

      const span = document.createElement('span');
      span.setAttribute(SPELL_MARK_ATTR, nextIssue.word);
      span.setAttribute(SPELL_MARK_ID_ATTR, nextIssue.id);
      span.setAttribute('data-suggestions', JSON.stringify(nextIssue.suggestions));
      span.setAttribute('data-label', nextIssue.label);
      span.className = 'cursor-context-menu underline decoration-red-500 decoration-[1.25px] underline-offset-[2px] [text-decoration-style:wavy]';
      span.textContent = text.slice(nextIndex, nextIndex + nextIssue.matchText.length);
      frag.appendChild(span);
      cursor = nextIndex + nextIssue.matchText.length;
    }

    if (!hasMarkedWord) continue;
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(frag, node);
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = String(reader.result);
      resolve(res.includes(',') ? res.slice(res.indexOf(',') + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface EmailModuleProps {
  params?: { emailId?: string } | null;
}

export default function EmailModule({ params }: EmailModuleProps = {}) {
  const { user } = useAuth();
  const [folder, setFolder] = useState<EmailFolder>('inbox');
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [thread, setThread] = useState<EmailMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [search, setSearch] = useState('');
  // Campo da busca (digitação imediata) vs. termo aplicado (debounced) — evita
  // disparar uma query no banco a cada tecla numa caixa com milhares de e-mails.
  const [searchInput, setSearchInput] = useState('');
  // `searchFilters` reflete o que está digitado nos campos (imediato); os campos
  // de texto entram em vigor via `appliedFilters` (com debounce) para não disparar
  // uma query no banco a cada tecla numa caixa com milhares de e-mails.
  const [searchFilters, setSearchFilters] = useState<EmailSearchFilters>(EMPTY_EMAIL_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<EmailSearchFilters>(EMPTY_EMAIL_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [spamUnread, setSpamUnread] = useState(0);

  const [limit, setLimit] = useState(() => loadPrefs().perPage);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [emptyingTrash, setEmptyingTrash] = useState(false);
  const [trashScope, setTrashScope] = useState<'all' | 'read' | 'unread'>('all');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const [foldersW, setFoldersW] = useState(() => Number(localStorage.getItem(LS_FOLDERS_W)) || 160);
  const [listW, setListW] = useState(() => Number(localStorage.getItem(LS_LIST_W)) || 320);
  // Refs das colunas: durante o arraste mudamos a largura direto no DOM (sem
  // setState) para o gesto ficar fluido; só "commitamos" no estado/banco ao soltar.
  const foldersColRef = useRef<HTMLDivElement>(null);
  const listColRef = useRef<HTMLDivElement>(null);
  // Raiz do módulo — usada p/ achar os iframes da leitura e desligar o
  // pointer-events deles durante o arraste (senão o iframe "engole" o mouse e
  // o gesto trava). Sem overlay/veu: nada de re-render nem escurecer a tela.
  const rootRef = useRef<HTMLDivElement>(null);

  // Responsivo: container < 768px vira single-pane (lista OU leitura).
  // Usa ResizeObserver no rootRef para responder ao tamanho do bloco, não da viewport.
  const [isNarrow, setIsNarrow] = useState(true);
  useEffect(() => {
    if (!rootRef.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setIsNarrow(entry.contentRect.width < 768);
    });
    obs.observe(rootRef.current);
    return () => obs.disconnect();
  }, []);

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeExpanded, setComposeExpanded] = useState(false);
  const [composeMinimized, setComposeMinimized] = useState(false);
  // Inline = responder/encaminhar no rodapé da conversa (sem sair da leitura).
  // Quando false e composeOpen, abre o compose em tela cheia (e-mail novo).
  const [composeInline, setComposeInline] = useState(false);

  // Menu de contexto (botão direito na lista)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; m: EmailMessage } | null>(null);
  const ctxRef = useRef<HTMLDivElement>(null);

  // Drag-and-drop de emails para pastas
  const [dragIds, setDragIds] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<EmailFolder | null>(null);
  const inlineReplyRef = useRef<HTMLDivElement>(null);
  const [compose, setCompose] = useState<ComposeState>(emptyCompose);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ to?: boolean; subject?: boolean }>({});
  // Rascunho: id da linha sendo editada, último estado salvo e estado inicial
  // (para não criar rascunho só por abrir o compose sem digitar nada).
  const draftIdRef = useRef<string | undefined>(undefined);
  const lastSavedKeyRef = useRef('');
  const initialComposeKeyRef = useRef('');
  const [draftStatus, setDraftStatus] = useState<'' | 'saving' | 'saved'>('');
  const composeRef = useRef<ComposeState>(emptyCompose);
  const sendingRef = useRef(false);
  const folderRef = useRef<EmailFolder>('inbox');
  const flushingDraftRef = useRef<Promise<string | null> | null>(null);

  const [signature, setSignature] = useState<EmailSignature | null>(null);
  const [savingSig, setSavingSig] = useState(false);

  const [prefs, setPrefs] = useState<EmailPrefs>(() => loadPrefs());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'geral' | 'assinatura' | 'antispam'>('geral');
  const [prefsDraft, setPrefsDraft] = useState<EmailPrefs>(prefs);
  const [sigDraft, setSigDraft] = useState<EmailSignature>({ user_id: '', name: '', signature_text: '', signature_html: '', use_html: false });

  const [spamRules, setSpamRules] = useState<EmailSpamRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleForm, setRuleForm] = useState<{ kind: SpamRuleKind; match_type: SpamRuleMatch; value: string }>({
    kind: 'whitelist', match_type: 'address', value: '',
  });
  const composeUiRef = useRef<EmailComposeUiPrefs>(loadComposeUiPrefs());
  const restoredDraftRef = useRef<string | null>(null);

  // Ids que devem PERMANECER na lista mesmo após saírem do filtro atual — ex.: no
  // filtro "Não lidas", o e-mail que você abre vira lido mas não pode sumir/fechar
  // embaixo do cursor. Limpo ao trocar pasta/busca/filtro.
  const keepVisibleRef = useRef<Set<string>>(new Set());
  // Espelha `composeOpen` num ref: `load` não pode depender do estado de compose
  // (recriaria a função e disparava reload a cada tecla digitada), mas precisa
  // saber se há uma composição em andamento para não fechar a leitura/resposta
  // embaixo do usuário quando um recarregamento silencioso (realtime) chega.
  const composeOpenRef = useRef(false);
  useEffect(() => { composeOpenRef.current = composeOpen; }, [composeOpen]);
  useEffect(() => { composeRef.current = compose; }, [compose]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { folderRef.current = folder; }, [folder]);

  // `silent`: recarrega sem trocar a lista por spinner (fluido). O spinner só
  // aparece no 1º carregamento (lista vazia); refresh/realtime não "piscam".
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [page, count, spamCount] = await Promise.all([
        emailService.listMessages(folder, search, limit, onlyUnread, appliedFilters, 0),
        emailService.countUnread('inbox'),
        emailService.countUnread('spam'),
      ]);
      const list = page.items;
      setTotal(page.total);
      setMessages((prev) => {
        // Reanexa os "fixados" que saíram do filtro (ex.: lido no filtro Não lidas),
        // preservando a ordem cronológica para não pular embaixo do cursor.
        const keep = keepVisibleRef.current;
        if (keep.size === 0) return list;
        const listIds = new Set(list.map((m) => m.id));
        const sticky = prev.filter((m) => keep.has(m.id) && !listIds.has(m.id));
        if (sticky.length === 0) return list;
        const ts = (m: EmailMessage) => new Date(m.sent_at || m.created_at).getTime();
        return [...list, ...sticky].sort((a, b) => ts(b) - ts(a));
      });
      setHasMore(page.total > list.length);
      setUnread(count);
      setSpamUnread(spamCount);
      // Mantém aberto o e-mail selecionado mesmo que tenha saído do filtro (fixado)
      // ou que haja uma composição (nova/resposta) em andamento — um recarregamento
      // silencioso de fundo (realtime) não pode fechar a caixa de composição.
      setSelected((prev) => (prev && (list.some((m) => m.id === prev.id) || keepVisibleRef.current.has(prev.id) || composeOpenRef.current) ? prev : null));
      setChecked((prev) => new Set([...prev].filter((id) => list.some((m) => m.id === id) || keepVisibleRef.current.has(id))));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [folder, search, limit, onlyUnread, appliedFilters]);

  useEffect(() => { load(); }, [load]);
  // Ao trocar de pasta/busca/filtro, volta ao tamanho de página inicial e limpa seleção.
  useEffect(() => { setLimit(prefs.perPage); setChecked(new Set()); keepVisibleRef.current = new Set(); }, [folder, search, prefs.perPage, onlyUnread, appliedFilters]);
  useEffect(() => { emailService.getSignature().then((s) => { if (s) setSignature(s); }).catch(() => {}); }, []);
  useEffect(() => { emailService.listSpamRules().then(setSpamRules).catch(() => {}); }, []);

  // Fecha menu de contexto ao clicar fora ou pressionar Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [ctxMenu]);
  // Debounce da busca: aplica o termo 350ms após parar de digitar.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(t);
  }, [searchInput]);
  // Debounce dos filtros avançados: os campos de texto (remetente/destinatário/
  // assunto) só vão ao banco 350ms após parar de digitar; datas e checkboxes,
  // por serem toques únicos, entram em vigor praticamente na hora.
  useEffect(() => {
    const textChanged =
      searchFilters.from !== appliedFilters.from ||
      searchFilters.to !== appliedFilters.to ||
      searchFilters.subject !== appliedFilters.subject;
    const delay = textChanged ? 350 : 0;
    const t = setTimeout(() => setAppliedFilters(searchFilters), delay);
    return () => clearTimeout(t);
  }, [searchFilters, appliedFilters]);
  // Ao abrir a resposta inline (agora no topo), rola até ela pelo início.
  useEffect(() => {
    if (composeOpen && composeInline) {
      const t = setTimeout(() => inlineReplyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
      return () => clearTimeout(t);
    }
  }, [composeOpen, composeInline]);

  // Atualização automática ao vivo: novo email chega -> recarrega (sem piscar).
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Debounce: rajadas (ex.: backfill de milhares) colapsam numa única recarga silenciosa.
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadRef.current(true); }, 1200);
    };
    const ch = supabase
      .channel('email-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'email_messages' }, scheduleReload)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, []);

  const openMessage = async (m: EmailMessage) => {
    // Fecha uma resposta inline aberta ao navegar para outra mensagem.
    if (composeInline) { setComposeOpen(false); setComposeInline(false); }
    if (composeOpenRef.current && !composeInline) {
      setComposeExpanded(false);
      setComposeMinimized(true);
      persistComposeUiState({ composeMinimized: true });
    }
    setSelected(m);
    setFocusedId(m.id);
    // Abriu o e-mail: a notificação de "novo e-mail" no sino não deve mais
    // persistir. Marca no banco e avisa o sino para sumir na hora (sem esperar
    // o polling). Idempotente — só atinge notificações ainda não lidas.
    if (m.direction === 'inbound') {
      userNotificationService.markEmailNotificationsRead(m.id).catch(() => {});
      window.dispatchEvent(new CustomEvent('email-notif-read', { detail: { emailId: m.id } }));
    }
    // Carrega a conversa (thread) para a leitura encadeada.
    if (m.thread_key) {
      setThreadLoading(true);
      emailService.listThread(m.thread_key)
        .then((msgs) => {
          const resolved = msgs.length ? msgs : [m];
          setThread(resolved);
          // Abre a mensagem mais recente da thread por padrão (índice 0 = mais novo).
          setSelected(resolved[0]);
        })
        .catch(() => setThread([m]))
        .finally(() => setThreadLoading(false));
    } else {
      setThread([m]);
    }
    if (prefs.autoMarkRead && !m.is_read && m.direction === 'inbound') {
      // No filtro "Não lidas", fixa o e-mail para ele não sumir ao virar lido.
      if (onlyUnread) keepVisibleRef.current.add(m.id);
      try {
        await emailService.markRead(m.id, true);
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_read: true } : x)));
        setUnread((u) => Math.max(0, u - 1));
      } catch { /* noop */ }
    }
  };

  const dropFromList = (id: string) => {
    setMessages((prev) => prev.filter((x) => x.id !== id));
    setSelected((prev) => (prev?.id === id ? null : prev));
    setChecked((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  const moveEmailToFolder = async (m: EmailMessage, dest: EmailFolder) => {
    if (dest === folder) return;
    try {
      if (dest === 'trash') {
        // Mantém is_spam como metadado; restore depois devolve ao lugar certo.
        await emailService.moveToTrash(m.id);
      } else if (dest === 'spam') {
        // Limpa is_trash também (sai da lixeira se estava lá).
        await emailService.markSpam(m, true);
      } else if (dest === 'inbox') {
        // Limpa AMBAS as flags independente do estado atual.
        // unmarkSpam chama moveToInbox internamente (is_spam=false, is_trash=false).
        if (m.is_spam) await emailService.unmarkSpam(m, true);
        else await emailService.moveToInbox(m.id);
      }
      dropFromList(m.id);
    } catch { /* noop */ }
  };

  // Abertura direta via notificação ("Novo e-mail"): busca a mensagem pelo id,
  // posiciona na pasta coerente e abre a leitura. Roda quando o emailId muda.
  const openMessageRef = useRef(openMessage);
  openMessageRef.current = openMessage;
  useEffect(() => {
    const id = params?.emailId;
    if (!id) return;
    let cancelled = false;
    emailService.getMessage(id)
      .then((m) => {
        if (cancelled || !m) return;
        setFolder(resolveFolder(m));
        void openMessageRef.current(m);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [params?.emailId]);

  // ── Seleção múltipla ────────────────────────────────────────────────────
  // Âncora do intervalo + "base" da sessão de range (seleção que existia ANTES
  // de começar a arrastar com Shift). Recalcular sobre a base a cada passo faz o
  // intervalo ENCOLHER ao reverter (desmarcar), em vez de só crescer.
  const anchorIdRef = useRef<string | null>(null);
  const rangeBaseRef = useRef<Set<string> | null>(null);
  const endRangeSession = () => { rangeBaseRef.current = null; };

  const toggleChecked = (id: string) => {
    setChecked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    anchorIdRef.current = id;
    endRangeSession();
  };
  const allChecked = messages.length > 0 && checked.size === messages.length;
  const toggleCheckAll = () => {
    setChecked(allChecked ? new Set() : new Set(messages.map((m) => m.id)));
    endRangeSession();
  };
  const clearSelection = () => { setChecked(new Set()); endRangeSession(); };

  // Aplica o intervalo âncora→cursor sobre a base da sessão. Como recalcula tudo
  // a cada chamada, reverter o sentido (Shift+seta de volta) desmarca os itens
  // que saíram do intervalo, preservando a seleção pré-existente (base).
  const applyRange = (cursorId: string) => {
    const ids = messages.map((m) => m.id);
    if (!anchorIdRef.current) anchorIdRef.current = selected?.id ?? cursorId;
    if (!rangeBaseRef.current) rangeBaseRef.current = new Set(checked);
    const a = ids.indexOf(anchorIdRef.current);
    const b = ids.indexOf(cursorId);
    if (a === -1 || b === -1) { toggleChecked(cursorId); return; }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const next = new Set(rangeBaseRef.current);
    for (let i = lo; i <= hi; i++) next.add(ids[i]);
    setChecked(next);
  };

  // Clique numa linha: Ctrl/⌘ alterna a seleção; Shift seleciona intervalo;
  // clique simples abre a mensagem.
  const onRowClick = (m: EmailMessage, e: ReactMouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleChecked(m.id);
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      applyRange(m.id);
      setFocusedId(m.id);
      return;
    }
    anchorIdRef.current = m.id;
    endRangeSession();
    void openMessage(m);
  };

  // Alterna a seleção do item em foco (tecla Espaço) — estilo webmail.
  const toggleFocused = () => {
    const id = focusedId ?? selected?.id;
    if (id) toggleChecked(id);
  };

  const bulkRestore = async () => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkRestore(ids);
    setMessages((prev) => prev.filter((m) => !checked.has(m.id)));
    setSelected((prev) => (prev && checked.has(prev.id) ? null : prev));
    setChecked(new Set());
  };

  const bulkNotSpam = async () => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkSetSpam(ids, false);
    setMessages((prev) => prev.filter((m) => !checked.has(m.id)));
    setSelected((prev) => (prev && checked.has(prev.id) ? null : prev));
    setChecked(new Set());
  };

  const bulkTrash = async () => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkMoveToTrash(ids);
    setMessages((prev) => prev.filter((m) => !checked.has(m.id)));
    setSelected((prev) => (prev && checked.has(prev.id) ? null : prev));
    setChecked(new Set());
  };
  const bulkMarkRead = async (isRead: boolean) => {
    if (checked.size === 0) return;
    const ids = [...checked];
    await emailService.bulkMarkRead(ids, isRead);
    setMessages((prev) => prev.map((m) => (checked.has(m.id) ? { ...m, is_read: isRead } : m)));
    void load(true);
  };

  const onEmptyTrash = async () => {
    const labels = { all: 'TODOS os itens', read: 'os itens LIDOS', unread: 'os itens NÃO LIDOS' };
    if (!window.confirm(`Esvaziar lixeira: excluir permanentemente ${labels[trashScope]}? Esta ação não pode ser desfeita.`)) return;
    setEmptyingTrash(true);
    try {
      const n = await emailService.emptyTrash(trashScope);
      window.alert(`${n} item(ns) excluído(s) permanentemente.`);
      if (folder === 'trash') void load(true);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Falha ao esvaziar a lixeira.');
    } finally {
      setEmptyingTrash(false);
    }
  };

  // ── Atalhos de teclado ────────────────────────────────────────────────────
  // ↑/↓ ou j/k navega · Shift/Ctrl+↑/↓ estende e ENCOLHE seleção · Espaço marca
  // Enter abre · Del exclui · Ctrl/Cmd+A tudo · Esc limpa · r responder · a todos
  // f encaminhar · e alterna lido · s estrela · ! spam · ? ajuda
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable;

      if (composeOpen) {
        if (e.key === 'Escape' && !typing) { e.preventDefault(); setComposeOpen(false); setComposeInline(false); }
        return;
      }
      if (typing) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setChecked((prev) => (prev.size === messages.length ? new Set() : new Set(messages.map((m) => m.id))));
        return;
      }
      if (helpOpen) { if (e.key === 'Escape') setHelpOpen(false); return; }
      if (e.key === 'Escape') {
        if (checked.size > 0) { setChecked(new Set()); return; }
        if (selected) setSelected(null);
        return;
      }
      if (!messages.length) return;

      // Navegação parte do item ATUALMENTE selecionado (ou em foco).
      const idx = messages.findIndex((m) => m.id === (selected?.id ?? focusedId));
      const focusedMsg = selected ?? messages.find((x) => x.id === focusedId);
      const lower = e.key.toLowerCase();
      const isDown = e.key === 'ArrowDown' || lower === 'j';
      const isUp = e.key === 'ArrowUp' || lower === 'k';
      if (isDown || isUp) {
        e.preventDefault();
        const dir = isDown ? 1 : -1;
        const baseIdx = idx < 0 ? (dir === 1 ? -1 : 0) : idx;
        const nextIdx = Math.max(0, Math.min(messages.length - 1, baseIdx + dir));
        const next = messages[nextIdx];
        if (!next) return;
        if (e.shiftKey || mod) {
          // Estende a seleção pelo teclado (sem abrir cada e-mail).
          if (!anchorIdRef.current) anchorIdRef.current = messages[idx < 0 ? 0 : idx]?.id ?? next.id;
          setSelected(null);
          setFocusedId(next.id);
          applyRange(next.id);
        } else {
          anchorIdRef.current = next.id;
          endRangeSession();
          void openMessage(next); // muda seleção + atualiza preview
        }
        // Mantém a linha em foco visível na rolagem.
        listScrollRef.current?.querySelector(`[data-email-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === ' ') {
        // Espaço: alterna a seleção do item em foco (sem abrir).
        e.preventDefault();
        toggleFocused();
      } else if (e.key === 'Enter') {
        const m = messages.find((x) => x.id === focusedId) ?? selected;
        if (m) { e.preventDefault(); void openMessage(m); }
      } else if (e.key === 'Delete') {
        e.preventDefault();
        if (folder === 'trash') return; // na lixeira use "Esvaziar lixeira"
        if (checked.size > 0) { void bulkTrash(); return; }
        const id = focusedId ?? selected?.id;
        if (id) { void emailService.moveToTrash(id).then(() => dropFromList(id)); }
      } else if (lower === 'r' && selected) {
        e.preventDefault(); onReply();
      } else if (lower === 'a' && selected && !mod) {
        e.preventDefault(); onReplyAll();
      } else if (lower === 'f' && selected) {
        e.preventDefault(); onForward();
      } else if (lower === 'e' && focusedMsg) {
        e.preventDefault();
        void emailService.markRead(focusedMsg.id, !focusedMsg.is_read).then(() => {
          setMessages((prev) => prev.map((x) => (x.id === focusedMsg.id ? { ...x, is_read: !focusedMsg.is_read } : x)));
          if (selected?.id === focusedMsg.id) setSelected({ ...focusedMsg, is_read: !focusedMsg.is_read });
        });
      } else if (lower === 's' && focusedMsg) {
        e.preventDefault(); void toggleStar(focusedMsg);
      } else if (e.key === '!' && folder !== 'trash') {
        // ! marca como spam (ou tira do spam, se estiver na pasta Spam).
        e.preventDefault();
        void toggleSpamScope();
      } else if (e.key === '?') {
        e.preventDefault(); setHelpOpen(true);
      }
    };
    const onSelectAllShortcut = () => {
      if (settingsOpen || composeOpen || !messages.length) return;
      setChecked((prev) => (prev.size === messages.length ? new Set() : new Set(messages.map((m) => m.id))));
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener(EMAIL_SELECT_ALL_EVENT, onSelectAllShortcut);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener(EMAIL_SELECT_ALL_EVENT, onSelectAllShortcut);
    };
  }, [messages, focusedId, checked, selected, composeOpen, settingsOpen, folder, helpOpen]);

  const onMarkAllRead = async () => {
    const pendentes = await emailService.countUnread(folder);
    if (pendentes === 0) return;
    if (!window.confirm(`Marcar ${pendentes} email(s) não lido(s) como lidos?\n\nEsta ação não pode ser desfeita automaticamente.`)) return;
    const n = await emailService.markAllRead(folder);
    if (n > 0) void load(true);
  };

  // Mantém o email selecionado visível na lista (scroll automático ao navegar).
  useEffect(() => {
    if (!selected) return;
    const el = listScrollRef.current?.querySelector<HTMLElement>(`[data-email-id="${selected.id}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected?.id]);

  const toggleRead = async () => {
    if (!selected) return;
    const next = !selected.is_read;
    await emailService.markRead(selected.id, next);
    setMessages((prev) => prev.map((x) => (x.id === selected.id ? { ...x, is_read: next } : x)));
    setSelected({ ...selected, is_read: next });
    setUnread((u) => (next ? Math.max(0, u - 1) : u + 1));
  };

  // Alterna estrela de uma mensagem (otimista). Na pasta "Com estrela",
  // desmarcar remove a linha da lista.
  const toggleStar = async (m: EmailMessage, e?: ReactMouseEvent) => {
    e?.stopPropagation();
    const next = !m.is_starred;
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_starred: next } : x)));
    if (selected?.id === m.id) setSelected((s) => (s ? { ...s, is_starred: next } : s));
    try {
      await emailService.toggleStar(m.id, next);
      if (!next && folder === 'starred') dropFromList(m.id);
    } catch {
      // reverte em caso de falha
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, is_starred: !next } : x)));
      if (selected?.id === m.id) setSelected((s) => (s ? { ...s, is_starred: !next } : s));
    }
  };

  const onSpam = async () => {
    if (!selected) return;
    await emailService.markSpam(selected, true);
    dropFromList(selected.id);
  };
  const onNotSpam = async () => {
    if (!selected) return;
    await emailService.unmarkSpam(selected, true);
    dropFromList(selected.id);
  };
  const onTrash = async () => {
    if (!selected) return;
    await emailService.moveToTrash(selected.id);
    dropFromList(selected.id);
  };

  // Atalho "!" — alterna spam no escopo certo: se há seleção múltipla age nela,
  // senão no item em foco/aberto. Na pasta Spam, tira do spam; fora dela, marca.
  const toggleSpamScope = async () => {
    const toSpam = folder !== 'spam';
    if (checked.size > 0) {
      const ids = [...checked];
      await emailService.bulkSetSpam(ids, toSpam);
      setMessages((prev) => prev.filter((m) => !checked.has(m.id)));
      setSelected((prev) => (prev && checked.has(prev.id) ? null : prev));
      setChecked(new Set());
      return;
    }
    const m = selected ?? messages.find((x) => x.id === focusedId);
    if (!m) return;
    if (toSpam) await emailService.markSpam(m, true);
    else await emailService.unmarkSpam(m, true);
    dropFromList(m.id);
  };
  const onRestore = async () => {
    if (!selected) return;
    await emailService.restoreFromTrash(selected.id);
    dropFromList(selected.id);
  };

  // Monta o corpo inicial do editor: espaço p/ digitar + assinatura + (citação).
  // Duas linhas em branco no topo dão respiro para escrever; um separador sutil
  // (estilo webmail) divide a mensagem da assinatura.
  const buildInitialBody = (quoteHtml = '') => {
    const sig = sigToHtml(signature);
    const sigBlock = sig
      ? buildSignatureBlockHtml(sig)
      : '';
    return `<p><br></p><p><br></p>${sigBlock}${quoteHtml}`;
  };

  const persistComposeUiState = useCallback((override?: Partial<EmailComposeUiPrefs>) => {
    const next: EmailComposeUiPrefs = {
      ...composeUiRef.current,
      activeDraftId: draftIdRef.current ?? null,
      composeMinimized,
      ...override,
    };
    composeUiRef.current = next;
    try { localStorage.setItem(LS_COMPOSE_UI, JSON.stringify(next)); } catch { /* noop */ }
    if (user?.id) {
      dashboardPreferencesService.saveEmailLayoutPrefs(user.id, {
        foldersW: widthsRef.current.foldersW,
        listW: widthsRef.current.listW,
        activeDraftId: next.activeDraftId,
        composeMinimized: next.composeMinimized,
      }).catch(() => {});
    }
  }, [composeMinimized, user?.id]);

  const flushDraftNow = useCallback(async (reason: 'autosave' | 'nav-away' | 'unmount' = 'autosave'): Promise<string | null> => {
    if (!composeOpenRef.current || sendingRef.current) return null;
    const currentCompose = composeRef.current;
    const key = composeKey(currentCompose);
    if (key === initialComposeKeyRef.current || key === lastSavedKeyRef.current) return draftIdRef.current ?? null;
    if (flushingDraftRef.current) return flushingDraftRef.current;

    if (reason === 'autosave') setDraftStatus('saving');

    const pending = emailService.saveDraft({
      id: draftIdRef.current,
      to: currentCompose.to,
      cc: currentCompose.cc,
      bcc: currentCompose.bcc,
      subject: currentCompose.subject,
      html: currentCompose.bodyHtml,
      inReplyTo: currentCompose.inReplyTo,
      threadKey: currentCompose.threadKey,
      clientId: currentCompose.clientId,
    }).then((id) => {
      draftIdRef.current = id;
      persistComposeUiState({ activeDraftId: id });
      lastSavedKeyRef.current = key;
      if (reason === 'autosave') setDraftStatus('saved');
      if (folderRef.current === 'drafts') void loadRef.current(true);
      return id;
    }).catch((error) => {
      if (reason === 'autosave') setDraftStatus('');
      throw error;
    }).finally(() => {
      flushingDraftRef.current = null;
    });

    flushingDraftRef.current = pending;
    return pending;
  }, [persistComposeUiState]);

  const startCompose = (preset?: Partial<ComposeState>, inline = false) => {
    const next = { ...emptyCompose, bodyHtml: buildInitialBody(), ...preset };
    // Novo compose: zera o rastreio de rascunho. Não há rascunho até o usuário digitar.
    draftIdRef.current = undefined;
    initialComposeKeyRef.current = composeKey(next);
    lastSavedKeyRef.current = composeKey(next);
    setDraftStatus('');
    setCompose(next);
    setSendError(null);
    setFieldErrors({});
    setComposeInline(inline);
    setComposeMinimized(false);
    setComposeExpanded(false);
    setComposeOpen(true);
    persistComposeUiState({ activeDraftId: null, composeMinimized: false });
  };

  // Abre um rascunho existente no compose para continuar editando.
  const openDraft = (m: EmailMessage) => {
    const next: ComposeState = {
      ...emptyCompose,
      to: m.to_text ?? '',
      cc: m.cc_text ?? '',
      bcc: m.bcc_text ?? '',
      subject: m.subject ?? '',
      bodyHtml: m.body_html || buildInitialBody(),
      showCc: !!(m.cc_text || m.bcc_text),
      inReplyTo: m.in_reply_to ?? undefined,
      threadKey: m.thread_key ?? undefined,
      clientId: m.client_id ?? undefined,
    };
    draftIdRef.current = m.id;
    initialComposeKeyRef.current = composeKey(next);
    lastSavedKeyRef.current = composeKey(next);
    setDraftStatus('saved');
    setCompose(next);
    setSendError(null);
    setComposeInline(false);
    setComposeMinimized(false);
    setComposeExpanded(false);
    setComposeOpen(true);
    persistComposeUiState({ activeDraftId: m.id, composeMinimized: false });
  };

  const discardCompose = () => {
    setComposeOpen(false);
    setComposeInline(false);
    setComposeMinimized(false);
    setComposeExpanded(false);
    persistComposeUiState({ activeDraftId: null, composeMinimized: false });
  };

  useEffect(() => {
    if (composeOpen && !composeInline) persistComposeUiState({ composeMinimized });
  }, [composeOpen, composeInline, composeMinimized, persistComposeUiState]);

  useEffect(() => {
    const flushOnLeave = () => {
      void flushDraftNow('nav-away').catch(() => {});
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushOnLeave();
    };

    window.addEventListener('pagehide', flushOnLeave);
    window.addEventListener('beforeunload', flushOnLeave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', flushOnLeave);
      window.removeEventListener('pagehide', flushOnLeave);
      void flushDraftNow('unmount').catch(() => {});
    };
  }, [flushDraftNow]);

  // Autosave do rascunho: salva 1,5s após parar de digitar, só se mudou desde a abertura.
  useEffect(() => {
    if (!composeOpen || sending) return;
    const key = composeKey(compose);
    if (key === initialComposeKeyRef.current || key === lastSavedKeyRef.current) return;
    setDraftStatus('saving');
    const t = setTimeout(async () => {
      try {
        await flushDraftNow('autosave');
      } catch {
        setDraftStatus('');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [compose, composeOpen, sending, flushDraftNow]);

  const onReply = () => {
    if (!selected) return;
    const original = selected.body_html
      ? `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${selected.body_html}</blockquote>`
      : `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</blockquote>`;
    const quote = `<br><div style="color:#888;font-size:13px">Em ${escapeHtml(formatTime(selected.sent_at))}, ${escapeHtml(senderName(selected))} escreveu:</div>${original}`;
    startCompose({
      to: selected.from_address ?? '',
      subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`,
      inReplyTo: selected.message_id,
      threadKey: selected.thread_key ?? selected.message_id,
      clientId: selected.client_id ?? undefined,
      bodyHtml: buildInitialBody(quote),
    }, true);
  };

  const onReplyAll = () => {
    if (!selected) return;
    const original = selected.body_html
      ? `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${selected.body_html}</blockquote>`
      : `<blockquote style="margin:0 0 0 8px;padding-left:12px;border-left:2px solid #ddd;color:#555">${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</blockquote>`;
    const quote = `<br><div style="color:#888;font-size:13px">Em ${escapeHtml(formatTime(selected.sent_at))}, ${escapeHtml(senderName(selected))} escreveu:</div>${original}`;
    // To = remetente original; Cc = demais destinatários (To+Cc) menos a própria conta e o remetente.
    const me = (user?.email ?? '').toLowerCase();
    const fromAddr = (selected.from_address ?? '').toLowerCase();
    const others = [...extractAddresses(selected.to_text), ...extractAddresses(selected.cc_text)]
      .filter((a) => a !== me && a !== fromAddr);
    const ccUnique = Array.from(new Set(others));
    startCompose({
      to: selected.from_address ?? '',
      cc: ccUnique.join(', '),
      showCc: ccUnique.length > 0,
      subject: selected.subject?.startsWith('Re:') ? selected.subject : `Re: ${selected.subject ?? ''}`,
      inReplyTo: selected.message_id,
      threadKey: selected.thread_key ?? selected.message_id,
      clientId: selected.client_id ?? undefined,
      bodyHtml: buildInitialBody(quote),
    }, true);
  };

  const onForward = () => {
    if (!selected) return;
    const body = selected.body_html
      ? selected.body_html
      : `<div>${escapeHtml(selected.body_text ?? '').replace(/\n/g, '<br>')}</div>`;
    const fwd = `<br><div style="color:#888;font-size:13px">---------- Mensagem encaminhada ----------<br>` +
      `De: ${escapeHtml(selected.from_text ?? selected.from_address ?? '')}<br>` +
      `Assunto: ${escapeHtml(selected.subject ?? '')}</div><br>${body}`;
    startCompose({
      subject: selected.subject?.startsWith('Fwd:') ? selected.subject : `Fwd: ${selected.subject ?? ''}`,
      bodyHtml: buildInitialBody(fwd),
    }, true);
  };

  const addAttachments = async (files: FileList | null) => {
    if (!files?.length) return;
    const loaded = await Promise.all(
      Array.from(files).map(async (f) => ({
        filename: f.name,
        content: await fileToBase64(f),
        contentType: f.type || undefined,
        size: f.size,
      })),
    );
    setCompose((c) => ({ ...c, attachments: [...c.attachments, ...loaded] }));
  };

  const stripHtml = (html: string) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent ?? '').trim();
  };

  const composeWarnings = useMemo(
    () => getComposeWarnings(compose, selected, user?.email ?? null),
    [compose, selected, user?.email]
  );

  const doSend = async () => {
    const toList = parseRecipients(compose.to);
    const missingTo = !toList.length;
    const missingSubject = !compose.subject;
    const missingBody = !stripHtml(compose.bodyHtml);
    if (missingTo || missingSubject || missingBody) {
      setFieldErrors({ to: missingTo, subject: missingSubject });
      setSendError(
        missingSubject && compose.inReplyTo
          ? 'Defina um assunto para a resposta antes de enviar.'
          : 'Preencha destinatário, assunto e mensagem.'
      );
      return;
    }
    const allRecipients = [...toList, ...parseRecipients(compose.cc), ...parseRecipients(compose.bcc)];
    const invalid = allRecipients.filter((e) => !isValidEmail(e));
    if (invalid.length) {
      setFieldErrors({ to: true });
      setSendError(`Endereço inválido: ${invalid.map(addressOf).join(', ')}`);
      return;
    }
    if (composeWarnings.length > 0) {
      const proceed = window.confirm(
        `Revise antes de enviar:\n\n${composeWarnings.map((warning) => `• ${warning.message}`).join('\n')}\n\nDeseja enviar mesmo assim?`
      );
      if (!proceed) return;
    }
    setFieldErrors({});
    const dto: SendEmailDTO = {
      to: compose.to,
      cc: compose.cc.trim() || undefined,
      bcc: compose.bcc.trim() || undefined,
      subject: compose.subject,
      html: compose.bodyHtml,
      inReplyTo: compose.inReplyTo,
      threadKey: compose.threadKey,
      clientId: compose.clientId,
      attachments: compose.attachments.length
        ? compose.attachments.map(({ filename, content, contentType }) => ({ filename, content, contentType }))
        : undefined,
    };
    setSending(true);
    setSendError(null);
    try {
      await emailService.sendEmail(dto);
      // Enviou: remove o rascunho pelo id (se houver) e faz limpeza por subject como fallback.
      if (draftIdRef.current) {
        try { await emailService.deleteDraft(draftIdRef.current); } catch { /* noop */ }
        draftIdRef.current = undefined;
      }
      try { await emailService.purgeOrphanDrafts(dto.subject ?? ''); } catch { /* noop */ }
      const wasInline = composeInline;
      setComposeOpen(false);
      setComposeInline(false);
      setComposeMinimized(false);
      setComposeExpanded(false);
      persistComposeUiState({ activeDraftId: null, composeMinimized: false });
      // Resposta inline: recarrega a thread para mostrar a mensagem enviada.
      if (wasInline && selected?.thread_key) {
        emailService.listThread(selected.thread_key).then((msgs) => { if (msgs.length) setThread(msgs); }).catch(() => {});
      }
      void load(true); // recarga silenciosa (sem flash de spinner)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  };

  const loadSpamRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      setSpamRules(await emailService.listSpamRules());
    } catch { /* noop */ } finally {
      setRulesLoading(false);
    }
  }, []);

  const openSettings = (tab: 'geral' | 'assinatura' | 'antispam' = 'geral') => {
    setPrefsDraft(prefs);
    setSigDraft(signature ?? { user_id: '', name: '', signature_text: '', signature_html: '', use_html: false });
    setSettingsTab(tab);
    setSettingsOpen(true);
    void loadSpamRules();
  };

  const addRule = async () => {
    if (!ruleForm.value.trim()) return;
    await emailService.addSpamRule(ruleForm.kind, ruleForm.match_type, ruleForm.value);
    setRuleForm({ ...ruleForm, value: '' });
    await loadSpamRules();
  };
  const removeRule = async (id: string) => {
    await emailService.deleteSpamRule(id);
    await loadSpamRules();
  };
  const toggleRule = async (r: EmailSpamRule) => {
    await emailService.setSpamRuleEnabled(r.id, !r.enabled);
    await loadSpamRules();
  };

  const trustSender = async () => {
    if (!selected?.from_address) return;
    await emailService.addSpamRule('whitelist', 'address', selected.from_address);
    if (selected.is_spam) {
      await emailService.unmarkSpam(selected, true);
      dropFromList(selected.id);
    } else {
      // Confiou: zera os sinais p/ o aviso sumir (e não voltar ao recarregar).
      await emailService.clearSpamSignals(selected.id);
      const cleared = { is_spam: false, spam_score: 0, spam_reason: null };
      setSelected({ ...selected, ...cleared });
      setMessages((prev) => prev.map((m) => (m.id === selected.id ? { ...m, ...cleared } : m)));
    }
  };

  const blockDomain = async (m?: EmailMessage) => {
    const email = (m ?? selected)?.from_address;
    if (!email) return;
    const domain = email.split('@')[1];
    if (!domain) return;
    if (!window.confirm(`Bloquear todos os emails de @${domain}?\n\nEmails desse domínio irão direto para o Spam.`)) return;
    await emailService.addSpamRule('blocklist', 'domain', domain);
    void emailService.listSpamRules().then(setSpamRules).catch(() => {});
    const target = m ?? selected;
    if (target && !target.is_spam) {
      await emailService.markSpam(target, true);
      dropFromList(target.id);
    }
  };

  const saveSettings = async () => {
    setSavingSig(true);
    try {
      // Geral (prefs) — persistido por navegador
      const nextPrefs: EmailPrefs = {
        perPage: clamp(Math.round(prefsDraft.perPage) || DEFAULT_PREFS.perPage, 10, 500),
        autoMarkRead: prefsDraft.autoMarkRead,
      };
      localStorage.setItem(LS_PREFS, JSON.stringify(nextPrefs));
      setPrefs(nextPrefs);
      // Assinatura — persistida no banco por usuário
      await emailService.saveSignature(sigDraft);
      setSignature(sigDraft);
      setSettingsOpen(false);
    } finally {
      setSavingSig(false);
    }
  };

  const printSelected = () => {
    if (!selected) return;
    const win = window.open('', '_blank', 'width=820,height=900');
    if (!win) return;
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const meta = `
      <h2 style="margin:0 0 4px;font-size:18px">${esc(selected.subject || '(sem assunto)')}</h2>
      <div style="color:#555;font-size:13px;margin-bottom:2px"><b>De:</b> ${esc(selected.from_text || selected.from_address || '—')}</div>
      <div style="color:#555;font-size:13px;margin-bottom:2px"><b>Para:</b> ${esc(selected.to_text || '—')}</div>
      <div style="color:#888;font-size:12px;margin-bottom:12px">${esc(formatTime(selected.sent_at || selected.created_at))}</div>
      <hr style="border:none;border-top:1px solid #ddd;margin:0 0 12px">`;
    const content = selected.body_html
      ? selected.body_html
      : `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${esc(selected.body_text || '')}</pre>`;
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${esc(selected.subject || 'Email')}</title>` +
        `<style>body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px}img{max-width:100%}</style></head>` +
        `<body>${meta}${content}<script>window.onload=function(){setTimeout(function(){window.print();},250);};</script></body></html>`,
    );
    win.document.close();
  };

  // ── Redimensionamento das colunas (arrastar) ───────────────────────────
  // Larguras atuais num ref para os listeners lerem o valor fresco sem recriar.
  const widthsRef = useRef({ foldersW, listW });
  widthsRef.current = { foldersW, listW };

  // Carrega as larguras salvas no banco (seguem o usuário entre dispositivos).
  // O localStorage serve só de cache p/ não piscar no 1º render.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const cachedUi = loadComposeUiPrefs();
    composeUiRef.current = cachedUi;
    if (cachedUi.activeDraftId && restoredDraftRef.current !== cachedUi.activeDraftId) {
      restoredDraftRef.current = cachedUi.activeDraftId;
      emailService.getMessage(cachedUi.activeDraftId)
        .then((m) => {
          if (cancelled || !m?.is_draft) return;
          openDraft(m);
          setComposeMinimized(!!cachedUi.composeMinimized);
        })
        .catch(() => {});
    }
    dashboardPreferencesService.getEmailLayoutPrefs(user.id).then((p) => {
      if (cancelled || !p) return;
      if (typeof p.foldersW === 'number') { setFoldersW(clamp(p.foldersW, 120, 280)); localStorage.setItem(LS_FOLDERS_W, String(p.foldersW)); }
      if (typeof p.listW === 'number') { setListW(clamp(p.listW, 220, 540)); localStorage.setItem(LS_LIST_W, String(p.listW)); }
      composeUiRef.current = {
        activeDraftId: typeof p.activeDraftId === 'string' ? p.activeDraftId : null,
        composeMinimized: !!p.composeMinimized,
      };
      try { localStorage.setItem(LS_COMPOSE_UI, JSON.stringify(composeUiRef.current)); } catch { /* noop */ }
      if (composeUiRef.current.activeDraftId && restoredDraftRef.current !== composeUiRef.current.activeDraftId) {
        restoredDraftRef.current = composeUiRef.current.activeDraftId;
        emailService.getMessage(composeUiRef.current.activeDraftId)
          .then((m) => {
            if (cancelled || !m?.is_draft) return;
            openDraft(m);
            setComposeMinimized(!!composeUiRef.current.composeMinimized);
          })
          .catch(() => {});
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.id]);

  // Durante o arraste só mexemos no DOM (style.width) — zero re-render, gesto
  // fluido mesmo com o iframe pesado da leitura aberto.
  const dragging = useRef<{ which: 'folders' | 'list'; startX: number; startW: number; lastW: number } | null>(null);
  const setIframesInteractive = (interactive: boolean) => {
    rootRef.current?.querySelectorAll('iframe').forEach((f) => {
      (f as HTMLElement).style.pointerEvents = interactive ? '' : 'none';
    });
  };
  const onGutterDown = (which: 'folders' | 'list') => (e: React.MouseEvent) => {
    e.preventDefault();
    const startW = which === 'folders' ? foldersW : listW;
    dragging.current = { which, startX: e.clientX, startW, lastW: startW };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    setIframesInteractive(false); // iframe não captura mais o mouse durante o arraste
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragging.current;
      if (!d) return;
      const raw = d.startW + (e.clientX - d.startX);
      const w = d.which === 'folders' ? clamp(raw, 120, 280) : clamp(raw, 220, 540);
      d.lastW = w;
      const el = d.which === 'folders' ? foldersColRef.current : listColRef.current;
      if (el) el.style.width = `${w}px`;
    };
    const onUp = () => {
      const d = dragging.current;
      dragging.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setIframesInteractive(true);
      if (!d) return;
      // Commit no estado React (1 render) + cache local + banco.
      if (d.which === 'folders') setFoldersW(d.lastW); else setListW(d.lastW);
      const next = {
        foldersW: d.which === 'folders' ? d.lastW : widthsRef.current.foldersW,
        listW: d.which === 'list' ? d.lastW : widthsRef.current.listW,
      };
      localStorage.setItem(LS_FOLDERS_W, String(next.foldersW));
      localStorage.setItem(LS_LIST_W, String(next.listW));
      if (user?.id) dashboardPreferencesService.saveEmailLayoutPrefs(user.id, {
        ...next,
        activeDraftId: composeUiRef.current.activeDraftId,
        composeMinimized: composeUiRef.current.composeMinimized,
      }).catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [user?.id]);

  const folderInfo = useMemo(() => FOLDERS.find((f) => f.key === folder), [folder]);
  const activeFilterCount = useMemo(() => (
    [
      searchFilters.from.trim(),
      searchFilters.to.trim(),
      searchFilters.subject.trim(),
      searchFilters.dateFrom,
      searchFilters.dateTo,
      searchFilters.hasAttachments ? '1' : '',
      searchFilters.starredOnly ? '1' : '',
      onlyUnread ? '1' : '',
    ].filter(Boolean).length
  ), [searchFilters, onlyUnread]);

  return (
    <div ref={rootRef} className="relative flex h-full flex-col bg-[#f5f5f3] p-3 dark:bg-zinc-950 sm:p-4">
      {/* Pastas no mobile — barra horizontal (a coluna de pastas fica oculta < md) */}
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1 md:hidden">
        {FOLDERS.map(({ key, label, Icon }) => {
          const active = folder === key;
          return (
            <button key={key} onClick={() => { setFolder(key); setSelected(null); }}
              className={`flex flex-none items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] ${active ? 'bg-amber-50 font-medium text-amber-800' : 'border border-[#e7e5df] bg-white text-zinc-600'}`}>
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-amber-600' : 'text-zinc-400'}`} />
              {label}
              {key === 'inbox' && unread > 0 && (
                <span className="rounded-full bg-amber-600 px-1.5 text-[10px] font-medium text-white">{unread}</span>
              )}
              {key === 'spam' && spamUnread > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-medium text-white">{spamUnread}</span>
              )}
            </button>
          );
        })}
        <button onClick={() => openSettings('geral')}
          className="flex flex-none items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-1.5 text-[12px] text-zinc-600">
          <Settings className="h-3.5 w-3.5 text-zinc-400" /> Configurações
        </button>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-[#e7e5df] bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {/* Pastas (desktop) */}
        <div ref={foldersColRef} style={{ width: foldersW }} className="hidden flex-none border-r border-[#e7e5df] p-2 dark:border-zinc-800 md:block">
          {FOLDERS.map(({ key, label, Icon }) => {
            const active = folder === key;
            return (
              <button key={key} onClick={() => setFolder(key)}
                onDragOver={(e) => { if (dragIds.size > 0) { e.preventDefault(); setDropTarget(key); } }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  const raw = e.dataTransfer.getData('text/plain');
                  let ids: string[];
                  try { ids = JSON.parse(raw); } catch { ids = [raw]; }
                  const toMove = messages.filter((x) => ids.includes(x.id));
                  toMove.forEach((msg) => void moveEmailToFolder(msg, key));
                  setDragIds(new Set()); setDropTarget(null);
                }}
                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  dropTarget === key && dragIds.size > 0
                    ? 'bg-amber-100 ring-2 ring-amber-400 ring-inset'
                    : active ? 'bg-amber-50 font-medium text-amber-800' : 'text-zinc-600 hover:bg-zinc-50'
                }`}>
                <Icon className={`h-4 w-4 flex-none ${active || (dropTarget === key && dragIds.size > 0) ? 'text-amber-600' : 'text-zinc-400'}`} />
                <span className="flex-1 truncate text-left">{label}</span>
                {key === 'inbox' && unread > 0 && (
                  <span className="rounded-full bg-amber-600 px-1.5 text-[11px] font-medium text-white">{unread}</span>
                )}
                {key === 'spam' && spamUnread > 0 && (
                  <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-medium text-white">{spamUnread}</span>
                )}
              </button>
            );
          })}

          {/* Configurações — abaixo da Lixeira */}
          <div className="my-1 border-t border-[#f0efe9]" />
          <button onClick={() => openSettings('geral')}
            className="mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50">
            <Settings className="h-4 w-4 flex-none text-zinc-400" />
            <span className="flex-1 truncate text-left">Configurações</span>
          </button>
        </div>

        <div onMouseDown={onGutterDown('folders')} className="hidden w-1.5 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-amber-300 md:block" />

        {/* Lista — full-width no mobile; some quando há mensagem aberta (single-pane) */}
        <div ref={listColRef} style={isNarrow ? undefined : { width: listW }}
          className={`${selected && isNarrow ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col border-r border-[#e7e5df] dark:border-zinc-800 md:flex md:flex-none`}>
          <div className="flex items-center gap-2 border-b border-[#e7e5df] p-2 dark:border-zinc-800">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-[#e7e5df] px-2.5 py-1.5">
              <Search className="h-4 w-4 text-zinc-400" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Pesquisar…"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400" />
              {searchInput && (
                <button onClick={() => setSearchInput('')} title="Limpar" className="flex-none text-zinc-400 hover:text-zinc-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              title="Busca avançada"
              className={`relative flex-none rounded-lg border p-1.5 ${filtersOpen || activeFilterCount ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-[#e7e5df] text-zinc-500 hover:bg-zinc-50'}`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {activeFilterCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-medium text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            <button onClick={() => load()} title="Atualizar"
              className="flex-none rounded-lg border border-[#e7e5df] p-1.5 text-zinc-500 hover:bg-zinc-50">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={() => setHelpOpen(true)} title="Atalhos de teclado (?)"
              className="flex-none rounded-lg border border-[#e7e5df] p-1.5 text-zinc-500 hover:bg-zinc-50">
              <Keyboard className="h-4 w-4" />
            </button>
          </div>
          {filtersOpen && (
            <div className="border-b border-[#f0efe9] bg-[#fcfbf8] px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filtros avançados
                </span>
                <button
                  onClick={() => { setSearchFilters(EMPTY_EMAIL_FILTERS); setOnlyUnread(false); }}
                  disabled={activeFilterCount === 0}
                  className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:cursor-default disabled:text-zinc-300 disabled:hover:bg-transparent"
                >
                  <X className="h-3 w-3" /> Limpar
                </button>
              </div>

              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-zinc-500">Remetente</span>
                    <input
                      value={searchFilters.from}
                      onChange={(e) => setSearchFilters((prev) => ({ ...prev, from: e.target.value }))}
                      placeholder="nome ou e-mail"
                      className="w-full rounded-lg border border-[#e7e5df] bg-white px-2.5 py-2 text-[12px] outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-zinc-500">Destinatário</span>
                    <input
                      value={searchFilters.to}
                      onChange={(e) => setSearchFilters((prev) => ({ ...prev, to: e.target.value }))}
                      placeholder="nome ou e-mail"
                      className="w-full rounded-lg border border-[#e7e5df] bg-white px-2.5 py-2 text-[12px] outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-zinc-500">Assunto</span>
                  <input
                    value={searchFilters.subject}
                    onChange={(e) => setSearchFilters((prev) => ({ ...prev, subject: e.target.value }))}
                    placeholder="palavras do assunto"
                    className="w-full rounded-lg border border-[#e7e5df] bg-white px-2.5 py-2 text-[12px] outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>

                <div>
                  <span className="mb-1 block text-[11px] font-medium text-zinc-500">Período</span>
                  <div className="grid grid-cols-2 items-center gap-2">
                    <input
                      type="date"
                      aria-label="Data inicial"
                      value={searchFilters.dateFrom}
                      max={searchFilters.dateTo || undefined}
                      onChange={(e) => setSearchFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
                      className="w-full min-w-0 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-2 text-[12px] text-zinc-600 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    />
                    <input
                      type="date"
                      aria-label="Data final"
                      value={searchFilters.dateTo}
                      min={searchFilters.dateFrom || undefined}
                      onChange={(e) => setSearchFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
                      className="w-full min-w-0 rounded-lg border border-[#e7e5df] bg-white px-2.5 py-2 text-[12px] text-zinc-600 outline-none transition-colors focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setSearchFilters((prev) => ({ ...prev, hasAttachments: !prev.hasAttachments }))}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${searchFilters.hasAttachments ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-[#e7e5df] bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800'}`}
                  >
                    <Paperclip className="h-3.5 w-3.5" /> Com anexo
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchFilters((prev) => ({ ...prev, starredOnly: !prev.starredOnly }))}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${searchFilters.starredOnly ? 'border-amber-300 bg-amber-100 text-amber-800' : 'border-[#e7e5df] bg-white text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800'}`}
                  >
                    <Star className="h-3.5 w-3.5" fill={searchFilters.starredOnly ? 'currentColor' : 'none'} /> Com estrela
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Barra de seleção / filtros */}
          {(messages.length > 0 || onlyUnread) && (
            <div className="flex items-center gap-2 border-b border-[#f0efe9] px-3 py-1.5 dark:border-zinc-800">
              <input type="checkbox" checked={allChecked} onChange={toggleCheckAll} disabled={messages.length === 0}
                ref={(el) => { if (el) el.indeterminate = checked.size > 0 && !allChecked; }}
                title="Selecionar todos (Ctrl+A)" />
              {checked.size > 0 ? (
                <>
                  <button onClick={clearSelection} title="Limpar seleção (Esc)" className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-700">
                    <X className="h-3.5 w-3.5" /> {checked.size} selecionado(s)
                  </button>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => bulkMarkRead(true)} title="Marcar como lido" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><MailOpen className="h-4 w-4" /></button>
                    <button onClick={() => bulkMarkRead(false)} title="Marcar como não lido" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><Mail className="h-4 w-4" /></button>
                    {folder === 'spam' && (
                      <button onClick={bulkNotSpam} title="Não é spam" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><Inbox className="h-4 w-4" /></button>
                    )}
                    {folder === 'trash' ? (
                      <button onClick={bulkRestore} title="Restaurar" className="rounded p-1 text-zinc-500 hover:bg-zinc-100"><RotateCcw className="h-4 w-4" /></button>
                    ) : (
                      <button onClick={bulkTrash} title="Mover para lixeira (Del)" className="rounded p-1 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                </>
              ) : (
                <div className="ml-auto flex items-center gap-1.5">
                  <button onClick={() => setOnlyUnread((v) => !v)}
                    className={`rounded-md px-2 py-0.5 text-[12px] ${onlyUnread ? 'bg-amber-100 font-medium text-amber-800' : 'text-zinc-500 hover:bg-zinc-100'}`}>
                    Não lidas
                  </button>
                  {unread > 0 && (folder === 'inbox') && (
                    <button onClick={onMarkAllRead} title="Marcar todas como lidas"
                      className="rounded-md px-2 py-0.5 text-[12px] text-zinc-500 hover:bg-zinc-100">
                      Marcar todas lidas
                    </button>
                  )}
                  {folder === 'trash' && messages.length > 0 && (
                    <button onClick={onEmptyTrash} disabled={emptyingTrash} title="Excluir permanentemente todos os itens da lixeira"
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">
                      {emptyingTrash ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Esvaziar lixeira
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {loading && messages.length === 0 ? (
              <EmailListSkeleton />
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                {folderInfo && <folderInfo.Icon className="mb-2 h-8 w-8 text-zinc-300" />}
                <p className="text-[13px] font-medium text-zinc-500">
                  {onlyUnread ? 'Nenhuma mensagem não lida.'
                    : folder === 'drafts' ? 'Sem rascunhos.'
                    : folder === 'trash' ? 'Lixeira vazia.'
                    : folder === 'spam' ? 'Nenhum spam por aqui.'
                    : search ? 'Nada encontrado para a busca.'
                    : 'Nenhuma mensagem.'}
                </p>
                {search && (
                  <button onClick={() => setSearchInput('')} className="mt-1.5 text-[12px] text-amber-700 hover:underline">
                    Limpar busca
                  </button>
                )}
              </div>
            ) : (
              <>
                {(() => { let lastKey = ''; return messages.map((m) => {
                  const isUnread = !m.is_read && m.direction === 'inbound';
                  const isSel = selected?.id === m.id;
                  const isFocused = focusedId === m.id;
                  const isChk = checked.has(m.id);
                  const bucket = dateBucket(m.sent_at || m.created_at);
                  const showHeader = bucket.key !== lastKey;
                  lastKey = bucket.key;
                  const name = senderName(m);
                  const preview = snippet(m);
                  return (
                    <div key={m.id}>
                      {showHeader && (
                        <div className="sticky top-0 z-[1] bg-white/95 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-zinc-400 backdrop-blur dark:bg-zinc-900/95">
                          {bucket.label}
                        </div>
                      )}
                      <div data-email-id={m.id} role="button" tabIndex={0}
                        draggable
                        onDragStart={(e) => {
                          const ids = checked.has(m.id) ? [...checked] : [m.id];
                          setDragIds(new Set(ids));
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', JSON.stringify(ids));
                        }}
                        onDragEnd={() => { setDragIds(new Set()); setDropTarget(null); }}
                        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                        onClick={(e) => onRowClick(m, e)}
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, m }); }}
                        className={`group flex w-full select-none items-start gap-2.5 border-b border-[#f0efe9] px-3 py-2.5 text-left dark:border-zinc-800 ${isSel ? 'bg-amber-50' : isChk ? 'bg-amber-100/60' : 'hover:bg-zinc-50'} ${isFocused && !isSel ? 'ring-1 ring-inset ring-amber-300' : ''} ${dragIds.has(m.id) ? 'opacity-40' : ''}`}>
                        <div className="relative mt-0.5 flex-none">
                          <input type="checkbox" checked={isChk}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleChecked(m.id)}
                            className={`absolute inset-0 z-10 m-auto h-4 w-4 ${isChk ? '' : 'opacity-0 group-hover:opacity-100'}`} />
                          <div className={`flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium ${avatarColor(name)} ${isChk ? 'opacity-0' : 'group-hover:opacity-0'}`}>
                            {name.charAt(0).toUpperCase() || '?'}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className={`truncate text-[13px] ${isUnread ? 'font-semibold text-zinc-900 dark:text-zinc-100' : 'text-zinc-600'}`}>{name}</span>
                            <div className="flex flex-none items-center gap-1.5">
                              <button onClick={(e) => toggleStar(m, e)} title={m.is_starred ? 'Remover estrela' : 'Marcar com estrela'}
                                className={`rounded p-0.5 ${m.is_starred ? 'text-amber-500' : 'text-zinc-300 opacity-0 hover:text-amber-500 group-hover:opacity-100'}`}>
                                <Star className="h-3.5 w-3.5" fill={m.is_starred ? 'currentColor' : 'none'} />
                              </button>
                              <span className="text-[11px] text-zinc-400">{formatTime(m.sent_at || m.created_at)}</span>
                            </div>
                          </div>
                          <div className={`mt-0.5 flex items-center gap-1.5 truncate text-[13px] ${isUnread ? 'font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-600'}`}>
                            {isUnread && <span className="h-1.5 w-1.5 flex-none rounded-full bg-amber-500" />}
                            {m.attachments?.length > 0 && <Paperclip className="h-3 w-3 flex-none text-zinc-400" />}
                            <span className="truncate">{m.subject || '(sem assunto)'}</span>
                          </div>
                          {preview && <div className="mt-0.5 truncate text-[12px] text-zinc-400">{preview}</div>}
                        </div>
                      </div>
                    </div>
                  );
                }); })()}
                {/* Paginação: carregar mais / carregar todos */}
                <div className="flex flex-col items-center gap-1.5 p-2 text-center">
                  {hasMore ? (
                    <>
                      <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <button onClick={() => setLimit((l) => l + prefs.perPage)} disabled={loading}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-50 disabled:opacity-60">
                          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Carregar mais
                        </button>
                        <button onClick={() => setLimit(total)} disabled={loading || total > 2000}
                          title={total > 2000 ? 'Muitos e-mails — refine com filtros ou período' : `Carregar todos os ${total}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60">
                          Carregar todos ({total})
                        </button>
                      </div>
                      <span className="text-[11px] text-zinc-400">Exibindo {messages.length} de {total}</span>
                    </>
                  ) : (
                    <span className="text-[11px] text-zinc-400">{total || messages.length} mensagem(ns)</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div onMouseDown={onGutterDown('list')} className="hidden w-1.5 flex-none cursor-col-resize bg-transparent transition-colors hover:bg-amber-300 md:block" />

        {/* Leitura — full-width no mobile; oculta quando nenhuma mensagem aberta */}
        <div className={`${!selected && !composeOpen && isNarrow ? 'hidden' : 'flex'} min-w-0 flex-1 flex-col md:flex`}>
          {composeOpen && !composeInline && !composeMinimized ? (
            /* Compose de novo e-mail embutido como 3ª coluna */
            <div className="flex min-h-0 flex-1 flex-col"
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) void doSend(); } }}>
              <div className="flex flex-none items-center justify-between border-b border-[#e7e5df] px-4 py-2.5 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                  <PenSquare className="h-4 w-4 text-amber-600" />
                  <span className="text-[14px] font-medium text-zinc-800 dark:text-zinc-100">
                    {compose.subject || 'Nova mensagem'}
                  </span>
                  {draftStatus === 'saving' && <span className="text-[11px] text-zinc-400">salvando…</span>}
                  {draftStatus === 'saved' && <span className="text-[11px] text-zinc-400">rascunho salvo</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setComposeExpanded((v) => !v)} title={composeExpanded ? 'Recolher' : 'Expandir'}
                    className="rounded-lg border border-[#e7e5df] bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300">
                    {composeExpanded
                      ? <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
                      : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>}
                  </button>
                  <button onClick={discardCompose}
                    className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300">
                    Cancelar
                  </button>
                  <button onClick={doSend} disabled={sending}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-[12px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Enviar
                  </button>
                </div>
              </div>
              {sendError && (
                <div className="flex flex-none items-center gap-1.5 border-b border-red-100 bg-red-50 px-4 py-2 text-[12px] text-red-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-none" />{sendError}
                </div>
              )}
              {composeWarnings.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5 flex-none" />
                  {composeWarnings.map((warning) => (
                    <span key={warning.id} className="rounded-full bg-white/80 px-2 py-0.5">{warning.message}</span>
                  ))}
                </div>
              )}
              <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
                <div className="flex items-center gap-2 border-b border-[#f0efe9] px-4 py-2 dark:border-zinc-800">
                  <span className="w-14 text-[12px] text-zinc-400">De</span>
                  <span className="text-[13px] text-zinc-700 dark:text-zinc-300">
                    {signature?.name ? `${signature.name} <${user?.email ?? ''}>` : (user?.email ?? '—')}
                  </span>
                </div>
                <div className="flex items-start gap-2 border-b border-[#f0efe9] px-4 py-2 dark:border-zinc-800">
                  <span className={`w-14 pt-1.5 text-[12px] ${fieldErrors.to ? 'text-red-500' : 'text-zinc-400'}`}>Para</span>
                  <div className="flex-1">
                    <RecipientChips value={compose.to}
                      onChange={(v) => { setCompose((c) => ({ ...c, to: v })); setFieldErrors((f) => ({ ...f, to: false })); setSendError(null); }}
                      placeholder="destinatario@exemplo.com" autoFocus hasError={fieldErrors.to} />
                  </div>
                  {!compose.showCc && (
                    <button onClick={() => setCompose({ ...compose, showCc: true })}
                      className="pt-1.5 text-[11px] text-zinc-400 hover:text-amber-700">Cc/Cco</button>
                  )}
                </div>
                {compose.showCc && (
                  <>
                    <div className="flex items-start gap-2 border-b border-[#f0efe9] px-4 py-2 dark:border-zinc-800">
                      <span className="w-14 pt-1.5 text-[12px] text-zinc-400">Cc</span>
                      <div className="flex-1">
                        <RecipientChips value={compose.cc} onChange={(v) => setCompose((c) => ({ ...c, cc: v }))}
                          placeholder="copia@exemplo.com" />
                      </div>
                    </div>
                    <div className="flex items-start gap-2 border-b border-[#f0efe9] px-4 py-2 dark:border-zinc-800">
                      <span className="w-14 pt-1.5 text-[12px] text-zinc-400">Cco</span>
                      <div className="flex-1">
                        <RecipientChips value={compose.bcc} onChange={(v) => setCompose((c) => ({ ...c, bcc: v }))}
                          placeholder="copia-oculta@exemplo.com" />
                      </div>
                    </div>
                  </>
                )}
                <div className={`flex items-center gap-2 border-b px-4 py-2 dark:border-zinc-800 ${fieldErrors.subject ? 'border-red-300 bg-red-50/40' : 'border-[#f0efe9]'}`}>
                  <span className={`w-14 text-[12px] ${fieldErrors.subject ? 'text-red-500' : 'text-zinc-400'}`}>Assunto</span>
                  <input value={compose.subject}
                    onChange={(e) => { setCompose({ ...compose, subject: e.target.value }); setFieldErrors((f) => ({ ...f, subject: false })); setSendError(null); }}
                    placeholder="Assunto"
                    className="flex-1 bg-transparent py-1 text-[13px] text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-100" />
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <RichEditor
                    key={compose.inReplyTo ?? 'new'}
                    fill
                    autoFocus
                    initialHtml={compose.bodyHtml}
                    signatureHtml={sigToHtml(signature)}
                    onChange={(html) => setCompose((c) => ({ ...c, bodyHtml: html }))}
                    onAttach={addAttachments}
                    aiContext={{ to: compose.to, subject: compose.subject }}
                    onSubjectSuggested={(s) => setCompose((c) => (c.subject.trim() ? c : { ...c, subject: s }))}
                  />
                </div>
                {compose.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-[#f0efe9] px-4 py-2">
                    {compose.attachments.map((a, i) => (
                      <span key={i} className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-zinc-50 px-2 py-1 text-[12px] text-zinc-600">
                        <Paperclip className="h-3.5 w-3.5 text-amber-600" />
                        <span className="max-w-[160px] truncate">{a.filename}</span>
                        <span className="text-zinc-400">{humanSize(a.size)}</span>
                        <button onClick={() => setCompose((c) => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
                          className="text-zinc-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : !selected ? (
            <div className="flex flex-1 flex-col items-center justify-center text-zinc-400">
              <Mail className="mb-2 h-8 w-8" />
              <p className="text-[13px]">Selecione uma mensagem em {folderInfo?.label}.</p>
            </div>
          ) : (
            <>
              <ReadingToolbar
                leading={(
                  <button onClick={() => setSelected(null)}
                    className="mr-1 flex flex-none items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-zinc-600 hover:bg-zinc-100 md:hidden">
                    <ChevronLeft className="h-4 w-4" /> Voltar
                  </button>
                )}
                actions={[
                  { key: 'reply', label: 'Responder', Icon: Reply, onClick: onReply },
                  { key: 'replyAll', label: 'Responder a todos', Icon: ReplyAll, onClick: onReplyAll },
                  { key: 'forward', label: 'Encaminhar', Icon: Forward, onClick: onForward },
                  { key: 'star', label: selected.is_starred ? 'Com estrela' : 'Estrela', Icon: Star, onClick: () => toggleStar(selected), active: selected.is_starred, fill: selected.is_starred },
                  { key: 'print', label: 'Imprimir', Icon: Printer, onClick: printSelected },
                  { key: 'read', label: selected.is_read ? 'Marcar não lido' : 'Marcar lido', Icon: selected.is_read ? Mail : MailOpen, onClick: toggleRead },
                  folder === 'spam'
                    ? { key: 'spam', label: 'Não é spam', Icon: Inbox, onClick: onNotSpam }
                    : { key: 'spam', label: 'Spam', Icon: AlertOctagon, onClick: onSpam, danger: true },
                  folder === 'trash'
                    ? { key: 'del', label: 'Restaurar', Icon: RotateCcw, onClick: onRestore }
                    : { key: 'del', label: 'Excluir', Icon: Trash2, onClick: onTrash, danger: true },
                  ...(selected.direction === 'inbound' && selected.from_address?.includes('@')
                    ? [{ key: 'block', label: `Bloquear @${selected.from_address.split('@')[1]}`, Icon: Ban, onClick: () => void blockDomain(), danger: true as const }]
                    : []),
                ]}
              />
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-[16px] font-medium text-zinc-900 dark:text-zinc-100">{selected.subject || '(sem assunto)'}</h3>
                  {thread.length > 1 && (
                    <span className="flex-none rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                      {thread.length} mensagens
                    </span>
                  )}
                  <div className="ml-auto">
                    <ClientLinkChip
                      message={selected}
                      onLinked={(clientId) => {
                        setSelected((prev) => (prev ? { ...prev, client_id: clientId } : prev));
                        setMessages((prev) => prev.map((m) => (m.id === selected.id ? { ...m, client_id: clientId } : m)));
                      }}
                    />
                  </div>
                </div>

                {(selected.is_spam || (selected.spam_reason && (selected.spam_score ?? 0) > 0)) && (
                  <div className={`mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${selected.is_spam ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
                    <ShieldCheck className="h-4 w-4 flex-none" />
                    <span className="font-medium">{selected.is_spam ? 'Marcado como spam' : 'Sinais de spam'}</span>
                    {selected.spam_score != null && <span>· score {Number(selected.spam_score).toFixed(2)}</span>}
                    {selected.spam_reason && <span className="text-zinc-500">· {selected.spam_reason}</span>}
                    {selected.from_address && (
                      <button onClick={trustSender} className="ml-auto rounded-md border border-current px-2 py-0.5 hover:bg-white/40">
                        Confiar no remetente
                      </button>
                    )}
                  </div>
                )}

                {(() => {
                  if (!selected.from_address) return null;
                  const domain = selected.from_address.split('@')[1];
                  const blockedRule = spamRules.find(
                    (r) => r.kind === 'blocklist' && r.enabled &&
                      ((r.match_type === 'domain' && r.value === domain) ||
                       (r.match_type === 'address' && r.value === selected.from_address))
                  );
                  if (!blockedRule) return null;
                  return (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] text-red-700">
                      <Ban className="h-4 w-4 flex-none" />
                      <span className="font-medium">Domínio bloqueado</span>
                      <span className="text-red-500">· @{domain}</span>
                      <span className="text-red-400">· Novos emails desse domínio vão direto para o Spam</span>
                      <button
                        onClick={async () => { await removeRule(blockedRule.id); }}
                        className="ml-auto rounded-md border border-current px-2 py-0.5 hover:bg-white/40">
                        Desbloquear
                      </button>
                    </div>
                  );
                })()}

                {/* Resposta/encaminhamento INLINE — no TOPO da conversa (estilo
                    Gmail): aparece logo abaixo do assunto, sem precisar rolar até
                    o fim do histórico. */}
                {composeOpen && composeInline && (
                  <div ref={inlineReplyRef} className="mb-4 rounded-xl border border-amber-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                    onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) void doSend(); } }}>
                    <div className="flex items-center justify-between gap-2 border-b border-[#f0efe9] px-3 py-2 dark:border-zinc-800">
                      <div className="flex min-w-0 items-center gap-2 text-[13px] text-zinc-600">
                        <Reply className="h-4 w-4 flex-none text-amber-600" />
                        <span className="truncate font-medium">{compose.subject || 'Resposta'}</span>
                        {draftStatus === 'saving' && <span className="flex-none text-[11px] text-zinc-400">salvando…</span>}
                        {draftStatus === 'saved' && <span className="flex-none text-[11px] text-zinc-400">rascunho salvo</span>}
                      </div>
                      <button onClick={() => { setComposeOpen(false); setComposeInline(false); }} title="Descartar"
                        className="flex-none rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"><X className="h-4 w-4" /></button>
                    </div>
                    <div className="flex flex-col gap-2 p-3">
                      <div className="flex items-start gap-2">
                        <span className={`w-12 flex-none pt-1.5 text-[12px] ${fieldErrors.to ? 'text-red-500' : 'text-zinc-500'}`}>Para</span>
                        <div className="flex-1">
                          <RecipientChips value={compose.to}
                            onChange={(v) => { setCompose((c) => ({ ...c, to: v })); setFieldErrors((f) => ({ ...f, to: false })); setSendError(null); }}
                            placeholder="destinatario@exemplo.com" hasError={fieldErrors.to} />
                        </div>
                        {!compose.showCc && (
                          <button onClick={() => setCompose({ ...compose, showCc: true })} className="flex-none pt-1.5 text-[12px] text-zinc-500 hover:text-amber-700">Cc/Cco</button>
                        )}
                      </div>
                      {compose.showCc && (
                        <>
                          <div className="flex items-start gap-2">
                            <span className="w-12 flex-none pt-1.5 text-[12px] text-zinc-500">Cc</span>
                            <div className="flex-1"><RecipientChips value={compose.cc} onChange={(v) => setCompose((c) => ({ ...c, cc: v }))} placeholder="copia@exemplo.com" /></div>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="w-12 flex-none pt-1.5 text-[12px] text-zinc-500">Cco</span>
                            <div className="flex-1"><RecipientChips value={compose.bcc} onChange={(v) => setCompose((c) => ({ ...c, bcc: v }))} placeholder="copia-oculta@exemplo.com" /></div>
                          </div>
                        </>
                      )}
                      <div className="flex items-center gap-2">
                        <span className={`w-12 flex-none text-[12px] ${fieldErrors.subject ? 'text-red-500' : 'text-zinc-500'}`}>Assunto</span>
                        <input value={compose.subject}
                          onChange={(e) => { setCompose({ ...compose, subject: e.target.value }); setFieldErrors((f) => ({ ...f, subject: false })); setSendError(null); }}
                          placeholder="Assunto"
                          className={`flex-1 rounded-lg border px-2.5 py-1 text-[13px] outline-none focus:border-amber-400 ${fieldErrors.subject ? 'border-red-400 bg-red-50/40' : 'border-[#e7e5df]'}`} />
                      </div>

                      <RichEditor key={compose.inReplyTo ?? 'inline'} initialHtml={compose.bodyHtml} autoFocus
                        signatureHtml={sigToHtml(signature)}
                        onChange={(html) => setCompose((c) => ({ ...c, bodyHtml: html }))} onAttach={addAttachments}
                        aiContext={{ to: compose.to, subject: compose.subject }}
                        onSubjectSuggested={(s) => setCompose((c) => (c.subject.trim() ? c : { ...c, subject: s }))} />

                      {compose.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {compose.attachments.map((a, i) => (
                            <span key={i} className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-zinc-50 px-2 py-1 text-[12px] text-zinc-600">
                              <Paperclip className="h-3.5 w-3.5 text-amber-600" />
                              <span className="max-w-[160px] truncate">{a.filename}</span>
                              <span className="text-zinc-400">{humanSize(a.size)}</span>
                              <button onClick={() => setCompose((c) => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
                                className="text-zinc-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                            </span>
                          ))}
                        </div>
                      )}

                      {sendError && <p className="text-[13px] text-red-600">{sendError}</p>}
                      {composeWarnings.length > 0 && (
                        <div className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                          {composeWarnings.map((warning) => (
                            <span key={warning.id} className="rounded-full bg-white/80 px-2 py-0.5">{warning.message}</span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button onClick={() => { setComposeOpen(false); setComposeInline(false); }}
                          className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-50">Descartar</button>
                        <button onClick={doSend} disabled={sending}
                          className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {threadLoading && thread.length <= 1 ? (
                  <div className="flex h-20 items-center justify-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                ) : (
                  (() => {
                    const conversation = thread.length ? thread : [selected];
                    const latest = conversation[0];
                    const older = conversation.slice(1);
                    return (
                      <div className="space-y-3">
                        <MessageView key={latest.id} m={latest} single defaultOpen featured />
                        {older.length > 0 && (
                          <details className="rounded-xl border border-[#ece7dc] bg-[#faf8f4]">
                            <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-medium text-zinc-600">
                              Histórico anterior · {older.length} {older.length === 1 ? 'mensagem' : 'mensagens'}
                            </summary>
                            <div className="border-t border-[#ece7dc] px-3 py-3">
                              {older.map((m, idx) => (
                                <MessageView key={m.id} m={m} single={false} defaultOpen={idx === 0} />
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Botão flutuante "Escrever" — acima do widget Mensagens (canto inferior direito) */}
      {!composeOpen && (
        <button onClick={() => startCompose()} title="Escrever" aria-label="Escrever"
          className="fixed bottom-[88px] right-5 z-[9990] flex h-14 w-14 items-center justify-center rounded-full bg-amber-600 text-white shadow-[0_8px_24px_-4px_rgba(217,119,6,.55)] ring-1 ring-white/20 transition-transform hover:scale-105 hover:bg-amber-700 active:scale-95 sm:right-6">
          <PenSquare className="h-6 w-6" />
        </button>
      )}

      {/* Compose expandido (tela cheia sobre o módulo) */}
      {composeOpen && !composeInline && composeMinimized && (
        <div className="fixed bottom-[88px] right-5 z-[9990] flex items-center gap-2 rounded-2xl border border-[#e7e5df] bg-white px-3 py-2 shadow-[0_10px_30px_-10px_rgba(15,23,42,0.35)] sm:right-6">
          <button
            type="button"
            onClick={() => setComposeMinimized(false)}
            className="flex items-center gap-2 text-left"
            title="Restaurar rascunho"
          >
            <PenSquare className="h-4 w-4 text-amber-600" />
            <div className="min-w-0">
              <div className="max-w-[180px] truncate text-[12px] font-medium text-zinc-800">
                {compose.subject || 'Nova mensagem'}
              </div>
              <div className="max-w-[180px] truncate text-[11px] text-zinc-400">
                {compose.to || 'Rascunho em andamento'}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={discardCompose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            title="Fechar rascunho"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {composeOpen && !composeInline && !composeMinimized && composeExpanded && (
        <div className="absolute inset-0 z-30 flex flex-col bg-white dark:bg-zinc-950"
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (!sending) void doSend(); } }}>
          <div className="flex flex-none items-center justify-between border-b border-[#e7e5df] px-5 py-3 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              <PenSquare className="h-5 w-5 text-amber-600" />
              <span className="text-[15px] font-medium text-zinc-800 dark:text-zinc-100">{compose.subject || 'Nova mensagem'}</span>
              {draftStatus === 'saving' && <span className="text-[12px] text-zinc-400">salvando…</span>}
              {draftStatus === 'saved' && <span className="text-[12px] text-zinc-400">rascunho salvo</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setComposeExpanded(false)} title="Recolher"
                className="rounded-lg border border-[#e7e5df] bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
              </button>
              <button onClick={discardCompose}
                className="rounded-lg border border-[#e7e5df] bg-white px-3 py-1.5 text-[13px] text-zinc-600 hover:bg-zinc-50">Cancelar</button>
              <button onClick={doSend} disabled={sending}
                className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
              </button>
            </div>
          </div>
          {sendError && (
            <div className="flex flex-none items-center gap-1.5 border-b border-red-100 bg-red-50 px-5 py-2 text-[12px] text-red-600">
              <AlertCircle className="h-3.5 w-3.5 flex-none" />{sendError}
            </div>
          )}
          {composeWarnings.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2 text-[12px] text-amber-800">
              <AlertCircle className="h-3.5 w-3.5 flex-none" />
              {composeWarnings.map((warning) => (
                <span key={warning.id} className="rounded-full bg-white/80 px-2 py-0.5">{warning.message}</span>
              ))}
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3 gap-2">
            <div className="flex items-center gap-2 border-b border-[#f0efe9] pb-2">
              <span className="w-14 text-[13px] text-zinc-400">De</span>
              <span className="text-[13px] text-zinc-700">
                {signature?.name ? `${signature.name} <${user?.email ?? ''}>` : (user?.email ?? '—')}
              </span>
            </div>
            <div className="flex items-start gap-2 border-b border-[#f0efe9] pb-2">
              <span className={`w-14 pt-1.5 text-[13px] ${fieldErrors.to ? 'text-red-500' : 'text-zinc-400'}`}>Para</span>
              <div className="flex-1"><RecipientChips value={compose.to}
                onChange={(v) => { setCompose((c) => ({ ...c, to: v })); setFieldErrors((f) => ({ ...f, to: false })); setSendError(null); }}
                placeholder="destinatario@exemplo.com" hasError={fieldErrors.to} /></div>
              {!compose.showCc && <button onClick={() => setCompose({ ...compose, showCc: true })} className="pt-1.5 text-[12px] text-zinc-400 hover:text-amber-700">Cc/Cco</button>}
            </div>
            {compose.showCc && (<>
              <div className="flex items-start gap-2 border-b border-[#f0efe9] pb-2">
                <span className="w-14 pt-1.5 text-[13px] text-zinc-400">Cc</span>
                <div className="flex-1"><RecipientChips value={compose.cc} onChange={(v) => setCompose((c) => ({ ...c, cc: v }))} placeholder="copia@exemplo.com" /></div>
              </div>
              <div className="flex items-start gap-2 border-b border-[#f0efe9] pb-2">
                <span className="w-14 pt-1.5 text-[13px] text-zinc-400">Cco</span>
                <div className="flex-1"><RecipientChips value={compose.bcc} onChange={(v) => setCompose((c) => ({ ...c, bcc: v }))} placeholder="copia-oculta@exemplo.com" /></div>
              </div>
            </>)}
            <div className={`flex items-center gap-2 border-b pb-2 ${fieldErrors.subject ? 'border-red-300 bg-red-50/40' : 'border-[#f0efe9]'}`}>
              <span className={`w-14 text-[13px] ${fieldErrors.subject ? 'text-red-500' : 'text-zinc-400'}`}>Assunto</span>
              <input value={compose.subject}
                onChange={(e) => { setCompose({ ...compose, subject: e.target.value }); setFieldErrors((f) => ({ ...f, subject: false })); setSendError(null); }}
                placeholder="Assunto"
                className="flex-1 bg-transparent text-[14px] text-zinc-800 outline-none placeholder:text-zinc-400" />
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <RichEditor key={(compose.inReplyTo ?? 'new') + '-exp'} fill autoFocus initialHtml={compose.bodyHtml}
                signatureHtml={sigToHtml(signature)}
                onChange={(html) => setCompose((c) => ({ ...c, bodyHtml: html }))} onAttach={addAttachments}
                aiContext={{ to: compose.to, subject: compose.subject }}
                onSubjectSuggested={(s) => setCompose((c) => (c.subject.trim() ? c : { ...c, subject: s }))} />
            </div>
            {compose.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-[#f0efe9] pt-2">
                {compose.attachments.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] bg-zinc-50 px-2 py-1 text-[12px] text-zinc-600">
                    <Paperclip className="h-3.5 w-3.5 text-amber-600" />
                    <span className="max-w-[200px] truncate">{a.filename}</span>
                    <span className="text-zinc-400">{humanSize(a.size)}</span>
                    <button onClick={() => setCompose((c) => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
                      className="text-zinc-400 hover:text-red-600"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Menu de contexto (botão direito na lista de e-mails) */}
      {ctxMenu && (() => {
        // 'sep' = separador visual; false/null = item omitido (não renderiza nada).
        type CtxItem = { icon: React.ReactNode; label: string; action: () => void; danger?: boolean } | 'sep' | false | null;
        const ctxItems: CtxItem[] = [
          { icon: <Reply className="h-4 w-4" />, label: 'Responder', action: () => { void openMessage(ctxMenu.m); setTimeout(onReply, 100); } },
          { icon: <ReplyAll className="h-4 w-4" />, label: 'Responder a todos', action: () => { void openMessage(ctxMenu.m); setTimeout(onReplyAll, 100); } },
          { icon: <Forward className="h-4 w-4" />, label: 'Encaminhar', action: () => { void openMessage(ctxMenu.m); setTimeout(onForward, 100); } },
          'sep',
          {
            icon: ctxMenu.m.is_read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />,
            label: ctxMenu.m.is_read ? 'Marcar como não lido' : 'Marcar como lido',
            action: () => {
              emailService.markRead(ctxMenu.m.id, !ctxMenu.m.is_read).catch(() => {});
              setMessages((prev) => prev.map((x) => x.id === ctxMenu.m.id ? { ...x, is_read: !ctxMenu.m.is_read } : x));
            },
          },
          {
            icon: <Star className="h-4 w-4" />,
            label: ctxMenu.m.is_starred ? 'Remover estrela' : 'Marcar com estrela',
            action: () => {
              emailService.toggleStar(ctxMenu.m.id, !ctxMenu.m.is_starred).catch(() => {});
              setMessages((prev) => prev.map((x) => x.id === ctxMenu.m.id ? { ...x, is_starred: !ctxMenu.m.is_starred } : x));
            },
          },
          'sep',
          // Ações de pasta adaptadas: não aparece a pasta atual como destino.
          folder !== 'inbox' && {
            icon: <Inbox className="h-4 w-4" />,
            label: folder === 'spam' ? 'Não é spam' : 'Mover para Caixa de entrada',
            action: () => void moveEmailToFolder(ctxMenu.m, 'inbox'),
          },
          folder !== 'spam' && {
            icon: <Flame className="h-4 w-4" />,
            label: 'Marcar como spam',
            action: () => void moveEmailToFolder(ctxMenu.m, 'spam'),
            danger: true,
          },
          ctxMenu.m.direction === 'inbound' && !!ctxMenu.m.from_address?.includes('@') && {
            icon: <Ban className="h-4 w-4" />,
            label: `Bloquear @${ctxMenu.m.from_address.split('@')[1]}`,
            action: () => void blockDomain(ctxMenu.m),
            danger: true,
          },
          folder === 'trash'
            ? { icon: <RotateCcw className="h-4 w-4" />, label: 'Restaurar', action: () => void moveEmailToFolder(ctxMenu.m, 'inbox') }
            : { icon: <Trash2 className="h-4 w-4" />, label: 'Excluir', action: () => void moveEmailToFolder(ctxMenu.m, 'trash'), danger: true },
        ];
        return (
          <div ref={ctxRef} style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
            className="min-w-[200px] overflow-hidden rounded-xl border border-[#e7e5df] bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
            onMouseDown={(e) => e.stopPropagation()}>
            {ctxItems.map((item, i) =>
              !item ? null
              : item === 'sep' ? <div key={i} className="my-1 border-t border-[#f0efe9] dark:border-zinc-800" />
              : (
                <button key={i} onClick={() => { item.action(); setCtxMenu(null); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-zinc-50 dark:hover:bg-zinc-800 ${item.danger ? 'text-red-600' : 'text-zinc-700 dark:text-zinc-300'}`}>
                  {item.icon}{item.label}
                </button>
              )
            )}
          </div>
        );
      })()}


      {settingsOpen && (
        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Configurações de Email" size="lg">
          <ModalBody>
            <div className="mb-4 inline-flex rounded-lg border border-[#e7e5df] p-0.5">
              <FormatBtn active={settingsTab === 'geral'} onClick={() => setSettingsTab('geral')} Icon={SlidersHorizontal}>Geral</FormatBtn>
              <FormatBtn active={settingsTab === 'assinatura'} onClick={() => setSettingsTab('assinatura')} Icon={PenLine}>Assinatura</FormatBtn>
              <FormatBtn active={settingsTab === 'antispam'} onClick={() => setSettingsTab('antispam')} Icon={ShieldCheck}>Antispam</FormatBtn>
            </div>

            {settingsTab === 'geral' && (
              <div className="space-y-4">
                <div>
                  <Label>Emails por página</Label>
                  <Input type="number" min={10} max={500} value={prefsDraft.perPage}
                    onChange={(e) => setPrefsDraft({ ...prefsDraft, perPage: Number(e.target.value) })} />
                  <p className="mt-1 text-[12px] text-zinc-400">Quantas mensagens carregar na lista (10–500).</p>
                </div>
                <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input type="checkbox" checked={prefsDraft.autoMarkRead}
                    onChange={(e) => setPrefsDraft({ ...prefsDraft, autoMarkRead: e.target.checked })} />
                  Marcar como lida automaticamente ao abrir a mensagem
                </label>

                <div className="border-t border-[#f0efe9] pt-4">
                  <Label>Limpar lixeira</Label>
                  <p className="mb-2 text-[12px] text-zinc-400">Exclui permanentemente itens da lixeira. Não pode ser desfeito.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={trashScope} onChange={(e) => setTrashScope(e.target.value as typeof trashScope)}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="all">Todo o período</option>
                      <option value="read">Apenas lidos</option>
                      <option value="unread">Apenas não lidos</option>
                    </select>
                    <button onClick={onEmptyTrash} disabled={emptyingTrash}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[13px] font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">
                      {emptyingTrash ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Esvaziar lixeira
                    </button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab === 'assinatura' && (
              <div className="space-y-3">
                <div>
                  <Label>Nome de exibição (opcional)</Label>
                  <Input value={sigDraft.name ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, name: e.target.value })} placeholder="Dr. Nome Sobrenome" />
                </div>
                <div>
                  <Label>Assinatura — texto simples</Label>
                  <textarea value={sigDraft.signature_text ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, signature_text: e.target.value })} rows={4}
                    className="w-full resize-y rounded-lg border border-[#e7e5df] px-3 py-2 text-[14px] outline-none focus:border-amber-400"
                    placeholder={'Dr. Nome Sobrenome\nOAB/XX 00.000'} />
                </div>
                <div>
                  <Label>Assinatura — HTML</Label>
                  <textarea value={sigDraft.signature_html ?? ''} onChange={(e) => setSigDraft({ ...sigDraft, signature_html: e.target.value })} rows={5}
                    className="w-full resize-y rounded-lg border border-[#e7e5df] px-3 py-2 font-mono text-[13px] outline-none focus:border-amber-400"
                    placeholder='<div><strong>Dr. Nome Sobrenome</strong><br>OAB/XX 00.000</div>' />
                  {sigDraft.signature_html && (
                    <div className="mt-2 rounded-lg border border-[#f0efe9] p-2">
                      <p className="mb-1 text-[11px] text-zinc-400">Prévia</p>
                      <iframe title="sig-preview" sandbox="" srcDoc={sigDraft.signature_html} className="h-24 w-full" />
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                  <input type="checkbox" checked={sigDraft.use_html} onChange={(e) => setSigDraft({ ...sigDraft, use_html: e.target.checked })} />
                  Usar HTML por padrão ao escrever
                </label>
              </div>
            )}

            {settingsTab === 'antispam' && (
              <div className="space-y-4">
                <p className="text-[12px] text-zinc-500">
                  A classificação combina autenticação do remetente (SPF/DKIM/DMARC), regras abaixo e heurísticas de conteúdo.
                  <b className="text-zinc-700"> Whitelist</b> nunca marca como spam; <b className="text-zinc-700">blocklist</b> vai direto pro spam.
                </p>

                {/* Formulário de nova regra */}
                <div className="flex flex-wrap items-end gap-2 rounded-lg border border-[#e7e5df] p-2.5">
                  <div>
                    <Label>Tipo</Label>
                    <select value={ruleForm.kind} onChange={(e) => setRuleForm({ ...ruleForm, kind: e.target.value as SpamRuleKind })}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="whitelist">Whitelist (confiável)</option>
                      <option value="blocklist">Blocklist (bloquear)</option>
                    </select>
                  </div>
                  <div>
                    <Label>Critério</Label>
                    <select value={ruleForm.match_type} onChange={(e) => setRuleForm({ ...ruleForm, match_type: e.target.value as SpamRuleMatch })}
                      className="rounded-lg border border-[#e7e5df] px-2 py-1.5 text-[13px] outline-none focus:border-amber-400">
                      <option value="address">Endereço</option>
                      <option value="domain">Domínio</option>
                      <option value="from_regex">Remetente (regex)</option>
                      <option value="subject_regex">Assunto (regex)</option>
                      <option value="body_regex">Corpo (regex)</option>
                    </select>
                  </div>
                  <div className="flex-1 min-w-[160px]">
                    <Label>Valor</Label>
                    <Input value={ruleForm.value} onChange={(e) => setRuleForm({ ...ruleForm, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') void addRule(); }}
                      placeholder={ruleForm.match_type === 'domain' ? 'exemplo.com.br' : ruleForm.match_type === 'address' ? 'fulano@exemplo.com' : 'expressão'} />
                  </div>
                  <button onClick={addRule}
                    className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-[13px] font-medium text-white hover:bg-amber-700">
                    <Plus className="h-4 w-4" /> Adicionar
                  </button>
                </div>

                {/* Lista de regras */}
                <div className="max-h-64 overflow-y-auto rounded-lg border border-[#e7e5df]">
                  {rulesLoading ? (
                    <div className="flex h-20 items-center justify-center text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
                  ) : spamRules.length === 0 ? (
                    <div className="px-4 py-8 text-center text-[13px] text-zinc-400">Nenhuma regra cadastrada.</div>
                  ) : (
                    spamRules.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 border-b border-[#f0efe9] px-3 py-2 last:border-0">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.kind === 'whitelist' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {r.kind === 'whitelist' ? 'Permitir' : 'Bloquear'}
                        </span>
                        <span className="text-[11px] text-zinc-400">{MATCH_LABEL[r.match_type]}</span>
                        <span className={`flex-1 truncate text-[13px] ${r.enabled ? 'text-zinc-800' : 'text-zinc-400 line-through'}`}>{r.value}</span>
                        <button onClick={() => toggleRule(r)} className="text-[12px] text-zinc-500 hover:text-amber-700">
                          {r.enabled ? 'Desativar' : 'Ativar'}
                        </button>
                        <button onClick={() => removeRule(r.id)} title="Excluir" className="text-zinc-400 hover:text-red-600">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setSettingsOpen(false)}>Cancelar</Button>
            <button onClick={saveSettings} disabled={savingSig}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-[14px] font-medium text-white hover:bg-amber-700 disabled:opacity-60">
              {savingSig ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar
            </button>
          </ModalFooter>
        </Modal>
      )}

      {/* Ajuda — atalhos de teclado */}
      {helpOpen && (
        <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title="Atalhos de teclado" size="md">
          <ModalBody>
            <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {([
                ['↑ / ↓  ou  j / k', 'Navegar pelas mensagens'],
                ['Shift/Ctrl + ↑/↓', 'Selecionar várias (intervalo)'],
                ['Espaço', 'Marcar/desmarcar o item em foco'],
                ['Ctrl/⌘ + clique', 'Alternar seleção de um item'],
                ['Shift + clique', 'Selecionar intervalo'],
                ['Ctrl/⌘ + A', 'Selecionar tudo'],
                ['Esc', 'Limpar seleção / fechar'],
                ['Enter', 'Abrir mensagem'],
                ['Del', 'Mover para a lixeira'],
                ['r', 'Responder'],
                ['a', 'Responder a todos'],
                ['f', 'Encaminhar'],
                ['e', 'Marcar como lido/não lido'],
                ['s', 'Marcar/tirar estrela'],
                ['!', 'Marcar/tirar do spam'],
                ['Ctrl/⌘ + Enter', 'Enviar (ao redigir)'],
                ['?', 'Mostrar esta ajuda'],
              ] as [string, string][]).map(([k, desc]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-[#f4f3ee] py-1.5 last:border-0">
                  <span className="text-[13px] text-zinc-600">{desc}</span>
                  <kbd className="flex-none rounded-md border border-[#e7e5df] bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500">{k}</kbd>
                </div>
              ))}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setHelpOpen(false)}>Fechar</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}

// Anexos de uma mensagem (chips clicáveis → URL assinada do bucket privado).
function AttachmentChips({ m }: { m: EmailMessage }) {
  if (!m.attachments?.length) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {m.attachments.map((a, i) => (
        <button key={i} onClick={async () => { if (a.path) { const u = await emailService.attachmentUrl(a.path); if (u) window.open(u, '_blank'); } }}
          className="flex items-center gap-1.5 rounded-lg border border-[#e7e5df] px-2 py-1 text-[12px] text-zinc-600 hover:bg-zinc-50">
          <Paperclip className="h-3.5 w-3.5 text-amber-600" />{a.filename || 'anexo'}
        </button>
      ))}
    </div>
  );
}

type ClientLite = Pick<Client, 'id' | 'full_name' | 'email' | 'phone' | 'mobile' | 'status' | 'client_type'>;

/**
 * Chip de vínculo e-mail↔cliente, na leitura. Sem vínculo: sugere automaticamente
 * se o remetente/destinatário bate com o e-mail cadastrado de algum cliente
 * (match exato, sem IA), ou permite buscar manualmente. Com vínculo: mostra o
 * nome e permite desvincular.
 */
function ClientLinkChip({ message, onLinked }: { message: EmailMessage; onLinked: (clientId: string | null) => void }) {
  const [linkedName, setLinkedName] = useState<string | null>(null);
  const [loadingName, setLoadingName] = useState(false);
  const [suggested, setSuggested] = useState<{ id: string; full_name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClientLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLinkedName(null);
    if (!message.client_id) return;
    let cancelled = false;
    setLoadingName(true);
    clientService.getClientById(message.client_id)
      .then((c) => { if (!cancelled) setLinkedName(c?.full_name ?? null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingName(false); });
    return () => { cancelled = true; };
  }, [message.client_id]);

  useEffect(() => {
    setSuggested(null);
    if (message.client_id) return;
    const addr = message.direction === 'inbound'
      ? message.from_address
      : addressOf(parseRecipients(message.to_text || '')[0] || '');
    if (!addr) return;
    let cancelled = false;
    clientService.getClientByEmail(addr)
      .then((c) => { if (!cancelled && c) setSuggested({ id: c.id, full_name: c.full_name }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [message.id, message.client_id, message.direction, message.from_address, message.to_text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) { setResults([]); return; }
    const q = query.trim();
    if (!q) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      clientService.searchClients(q, 6).then(setResults).catch(() => setResults([])).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, open]);

  const link = async (clientId: string, name: string) => {
    setLinking(true);
    try {
      await emailService.linkClient(message.id, clientId);
      setLinkedName(name);
      setSuggested(null);
      setOpen(false);
      setQuery('');
      onLinked(clientId);
    } catch { /* noop */ } finally { setLinking(false); }
  };

  const unlink = async () => {
    setLinking(true);
    try {
      await emailService.linkClient(message.id, null);
      setLinkedName(null);
      onLinked(null);
    } catch { /* noop */ } finally { setLinking(false); }
  };

  if (message.client_id) {
    return (
      <span className="flex flex-none items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">
        <User className="h-3.5 w-3.5" />
        {loadingName ? 'Carregando…' : (linkedName || 'Cliente vinculado')}
        <button type="button" onClick={() => void unlink()} disabled={linking} title="Desvincular"
          className="text-amber-500 hover:text-amber-700 disabled:opacity-50">
          <X className="h-3 w-3" />
        </button>
      </span>
    );
  }

  return (
    <div ref={panelRef} className="relative flex-none">
      {suggested && !open ? (
        <button type="button" onClick={() => void link(suggested.id, suggested.full_name)} disabled={linking}
          className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[12px] text-amber-700 hover:bg-amber-50 disabled:opacity-50">
          {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <User className="h-3 w-3" />}
          Vincular a {suggested.full_name}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full border border-[#e7e5df] px-2.5 py-1 text-[12px] text-zinc-500 hover:bg-zinc-50">
          <User className="h-3 w-3" /> Vincular a cliente
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-[110] w-[260px] rounded-xl border border-[#eadfce] bg-white p-2 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar cliente por nome ou e-mail…"
            className="w-full rounded-lg border border-[#e7e5df] px-2.5 py-1.5 text-[13px] outline-none focus:border-amber-400" />
          <div className="mt-1.5 max-h-[220px] overflow-y-auto">
            {searching && <div className="px-2 py-2 text-[12px] text-zinc-400">Buscando…</div>}
            {!searching && query.trim() && results.length === 0 && (
              <div className="px-2 py-2 text-[12px] text-zinc-400">Nenhum cliente encontrado.</div>
            )}
            {results.map((c) => (
              <button key={c.id} type="button" onClick={() => void link(c.id, c.full_name)} disabled={linking}
                className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-amber-50 disabled:opacity-50">
                <span className="text-[13px] font-medium text-zinc-800">{c.full_name}</span>
                {c.email && <span className="text-[11px] text-zinc-400">{c.email}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Uma mensagem na leitura. Quando faz parte de uma conversa (single=false) vira
 * um card colapsável (cabeçalho clicável); a última fica aberta por padrão.
 */
function MessageView({ m, single, defaultOpen, featured = false }: { m: EmailMessage; single: boolean; defaultOpen: boolean; featured?: boolean }) {
  const [open, setOpen] = useState(single || defaultOpen);
  const name = senderName(m);
  const time = formatTime(m.sent_at || m.created_at);
  const isOut = m.direction === 'outbound';
  const personLabel = isOut ? 'Você' : 'Cliente';
  const body = m.body_html
    ? <EmailHtmlFrame html={m.body_html} msgId={m.id} sender={m.from_address ?? m.from_text} />
    : <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-zinc-800 dark:text-zinc-200">{m.body_text || '(sem conteúdo)'}</pre>;

  if (single) {
    return (
      <div className={`rounded-2xl border px-4 py-4 ${featured ? 'border-amber-200 bg-amber-50/40' : 'border-[#ece7dc] bg-white'}`}>
        <div className="mb-4 flex items-center gap-2.5">
          <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-[13px] font-medium ${avatarColor(name)}`}>
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate text-[13px]">
              <span className="font-medium text-zinc-800 dark:text-zinc-100">{name}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOut ? 'bg-zinc-800 text-white' : 'bg-amber-100 text-amber-800'}`}>{personLabel}</span>
              {m.from_address && <span className="text-zinc-500"> &lt;{m.from_address}&gt;</span>}
            </div>
            <div className="text-[12px] text-zinc-400">para {m.to_text || '—'} · {time}</div>
          </div>
        </div>
        <AttachmentChips m={m} />
        {body}
      </div>
    );
  }

  return (
    <div className={`mb-2 overflow-hidden rounded-xl border ${open ? 'border-[#e7e5df]' : 'border-[#f0efe9]'}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-zinc-50">
        <div className={`flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-medium ${avatarColor(name)}`}>
          {name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
                {isOut ? `Você → ${m.to_text || '—'}` : name}
              </span>
              <span className={`flex-none rounded-full px-2 py-0.5 text-[10px] font-semibold ${isOut ? 'bg-zinc-800 text-white' : 'bg-amber-100 text-amber-800'}`}>{personLabel}</span>
            </div>
            <span className="flex-none text-[11px] text-zinc-400">{time}</span>
          </div>
          {open
            ? <div className="truncate text-[12px] text-zinc-400">{isOut ? `de ${name}` : `para ${m.to_text || '—'}`}</div>
            : <div className="truncate text-[12px] text-zinc-400">{snippet(m, 90)}</div>}
        </div>
      </button>
      {open && (
        <div className="border-t border-[#f5f4f0] px-3 py-3">
          <AttachmentChips m={m} />
          {body}
        </div>
      )}
    </div>
  );
}

/**
 * Remove o carregamento automático de imagens REMOTAS (http/https) do HTML —
 * pixels de rastreio só "disparam" quando o navegador busca a imagem. Mantém
 * imagens embutidas (cid:/data:). Guarda o src original em data-blk para o
 * "Exibir imagens" reconstituir. Cobre <img src/srcset>, style inline e <style>.
 */
function prepareEmailHtml(html: string, allowRemoteImages = false): { html: string; blocked: number } {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const isRemote = (u: string) => /^\s*https?:\/\//i.test(u);
    let blocked = 0;
    doc.querySelectorAll('a[href]').forEach((anchor) => {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
    });
    doc.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!allowRemoteImages && isRemote(src)) {
        img.setAttribute('data-blk', src);
        img.removeAttribute('src');
        img.removeAttribute('srcset');
        blocked++;
      }
    });
    if (!allowRemoteImages) {
      doc.querySelectorAll<HTMLElement>('[style*="url("]').forEach((el) => {
        const st = el.getAttribute('style') || '';
        if (/url\(\s*['"]?\s*https?:/i.test(st)) {
          el.setAttribute('style', st.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none'));
          blocked++;
        }
      });
      doc.querySelectorAll('style').forEach((s) => {
        const css = s.textContent || '';
        if (/url\(\s*['"]?\s*https?:/i.test(css)) {
          s.textContent = css.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none');
          blocked++;
        }
      });
    }
    return { html: '<!doctype html>' + doc.documentElement.outerHTML, blocked };
  } catch {
    return { html, blocked: 0 };
  }
}

/**
 * Renderiza o HTML do email num iframe que cresce ate a altura total do
 * conteudo — sem barra de rolagem interna. O scroll fica na coluna de leitura
 * (na pagina), nunca dentro do preview.
 * `sandbox="allow-same-origin"` (sem allow-scripts) permite medir a altura do
 * documento sem deixar o email executar JS. Imagens remotas começam bloqueadas
 * (anti-rastreio) e só carregam ao clicar em "Exibir imagens".
 */
function EmailHtmlFrame({ html, msgId, sender }: { html: string; msgId?: string; sender?: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);
  // Começa já liberado se o usuário já exibiu as imagens deste e-mail antes.
  const senderKey = useMemo(() => senderImageKey(sender), [sender]);
  const [showImages, setShowImages] = useState(() => !!senderKey && allowedImageSenders.has(senderKey));
  useEffect(() => {
    setShowImages(!!senderKey && allowedImageSenders.has(senderKey));
  }, [senderKey, msgId]);
  const revealImages = useCallback(() => {
    rememberAllowedImageSender(sender);
    setShowImages(true);
  }, [sender]);
  const processedBlocked = useMemo(() => prepareEmailHtml(html, false), [html]);
  const processedFull = useMemo(() => prepareEmailHtml(html, true), [html]);
  const effectiveHtml = showImages ? processedFull.html : processedBlocked.html;

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
    if (h > 0) setHeight(h + 8);
  }, []);

  const onLoad = useCallback(() => {
    measure();
    // Remede apos imagens carregarem (alteram a altura).
    const frame = ref.current as (HTMLIFrameElement & { __emailSelectAllHandler?: (event: KeyboardEvent) => void }) | null;
    const doc = frame?.contentDocument;
    if (doc) {
      if (frame?.__emailSelectAllHandler) {
        doc.removeEventListener('keydown', frame.__emailSelectAllHandler);
      }
      doc.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
        anchor.addEventListener('click', (event) => {
          const href = anchor.getAttribute('href');
          if (!href) return;
          event.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
        });
      });
      const forwardSelectAllShortcut = (event: KeyboardEvent) => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
        event.preventDefault();
        window.dispatchEvent(new Event(EMAIL_SELECT_ALL_EVENT));
      };
      frame.__emailSelectAllHandler = forwardSelectAllShortcut;
      doc.addEventListener('keydown', forwardSelectAllShortcut);
    }
    doc?.querySelectorAll('img').forEach((img) => {
      if (!img.complete) img.addEventListener('load', measure, { once: true });
    });
    setTimeout(measure, 300);
  }, [measure]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measure]);

  return (
    <>
      {!showImages && processedBlocked.blocked > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
          <ImageOff className="h-4 w-4 flex-none" />
          <span>Imagens remotas bloqueadas para proteger sua privacidade.</span>
          <button onClick={revealImages} className="ml-auto rounded-md border border-amber-300 bg-white px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-100">
            Exibir imagens
          </button>
        </div>
      )}
      <iframe
        ref={ref}
        title="email"
        sandbox="allow-same-origin"
        srcDoc={effectiveHtml}
        onLoad={onLoad}
        style={{ height }}
        scrolling="no"
        className="w-full overflow-hidden rounded-lg border border-[#f0efe9]"
      />
    </>
  );
}

/**
 * Editor rich-text leve (sem dependências) baseado em contentEditable +
 * execCommand. Gera HTML. Barra com negrito/itálico/sublinhado/listas/link
 * e botão de anexar — no estilo do compose do webmail.
 */
function RichEditor({ initialHtml, onChange, onAttach, fill, autoFocus, aiContext, onSubjectSuggested, signatureHtml }: {
  initialHtml: string;
  onChange: (html: string) => void;
  onAttach: (files: FileList | null) => void;
  fill?: boolean;
  autoFocus?: boolean;
  aiContext?: { to?: string; subject?: string };
  onSubjectSuggested?: (subject: string) => void;
  signatureHtml?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const ignoredIssuesRef = useRef<Set<string>>(new Set());
  const [plainText, setPlainText] = useState('');
  const [spellIssues, setSpellIssues] = useState<SpellIssue[]>([]);
  const [spellLoading, setSpellLoading] = useState(false);
  const [signaturePresent, setSignaturePresent] = useState(false);
  const [spellDecorationsEnabled, setSpellDecorationsEnabled] = useState(true);
  const [spellMenu, setSpellMenu] = useState<{
    x: number;
    y: number;
    issueId: string;
    ignoreKey: string;
    word: string;
    label: string;
    suggestions: string[];
  } | null>(null);
  const spellRequestSeqRef = useRef(0);

  // ── Escrever com IA ─────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiTone, setAiTone] = useState<'formal' | 'cordial' | 'direto'>('cordial');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aiOpen) return;
    const close = (e: MouseEvent) => {
      if (aiPanelRef.current && !aiPanelRef.current.contains(e.target as Node)) setAiOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAiOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [aiOpen]);

  // Insere o HTML gerado pela IA no lugar do corpo digitado — preserva
  // assinatura (`[data-signature]`) e citação de resposta (`blockquote`),
  // que ficam sempre DEPOIS do texto novo.
  const insertAiHtml = (html: string) => {
    const root = ref.current;
    if (!root) return;
    const marker = root.querySelector(`[${SIGNATURE_ATTR}], blockquote`);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    if (marker) {
      while (root.firstChild && root.firstChild !== marker) root.removeChild(root.firstChild);
      while (wrapper.firstChild) root.insertBefore(wrapper.firstChild, marker);
    } else {
      root.innerHTML = html;
    }
    placeCaretBeforeSignature(root);
    emitEditorState();
  };

  const generateWithAi = async () => {
    const instruction = aiPrompt.trim();
    if (!instruction || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await aiService.generateEmailDraft({
        instruction, tone: aiTone, to: aiContext?.to, subject: aiContext?.subject,
      });
      insertAiHtml(result.html);
      if (result.subject && !aiContext?.subject?.trim()) onSubjectSuggested?.(result.subject);
      setAiOpen(false);
      setAiPrompt('');
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Falha ao gerar e-mail com IA.');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== initialHtml) {
      ref.current.innerHTML = initialHtml;
      keepSelectionOutOfSignature(ref.current);
      setSignaturePresent(hasSignatureBlock(ref.current));
      setPlainText(ref.current.innerText || '');
    }
    if (autoFocus && ref.current) {
      ref.current.focus();
      placeCaretAtEditableStart(ref.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const close = () => setSpellMenu(null);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      if (resumeSpellDecorationsTimerRef.current !== null) {
        window.clearTimeout(resumeSpellDecorationsTimerRef.current);
        resumeSpellDecorationsTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const localIssues = buildLocalTextIssues(plainText);
    const localFiltered = localIssues.filter((issue) => !ignoredIssuesRef.current.has(issue.ignoreKey));
    const cleaned = plainText.replace(/\s+/g, ' ').trim();
    setSpellIssues(localFiltered);
    if (!cleaned) {
      setSpellLoading(false);
      return;
    }

    const requestSeq = ++spellRequestSeqRef.current;
    const controller = new AbortController();
    let loadingTimer: number | null = null;
    const timer = window.setTimeout(() => {
      loadingTimer = window.setTimeout(() => {
        if (requestSeq === spellRequestSeqRef.current && !controller.signal.aborted) {
          setSpellLoading(true);
        }
      }, 450);

      checkTextSpelling(cleaned, controller.signal)
        .then((issues) => {
          if (requestSeq !== spellRequestSeqRef.current) return;
          const merged = [...localIssues, ...issues];
          const filtered = merged.filter((issue) => !ignoredIssuesRef.current.has(issue.ignoreKey));
          setSpellIssues(filtered);
        })
        .catch((error) => {
          if (controller.signal.aborted || requestSeq !== spellRequestSeqRef.current) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setSpellIssues(localFiltered);
        })
        .finally(() => {
          if (loadingTimer !== null) {
            window.clearTimeout(loadingTimer);
            loadingTimer = null;
          }
          if (requestSeq === spellRequestSeqRef.current) setSpellLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      if (loadingTimer !== null) window.clearTimeout(loadingTimer);
      controller.abort();
      if (requestSeq === spellRequestSeqRef.current) setSpellLoading(false);
    };
  }, [plainText]);

  useEffect(() => {
    if (!ref.current || !spellDecorationsEnabled) return;
    const root = ref.current;
    const saved = captureSelectionOffsets(root);
    applySpellMarkers(root, spellIssues);
    restoreSelectionOffsets(root, saved);
  }, [spellIssues, spellDecorationsEnabled]);

  const savedRange = useRef<Range | null>(null);
  const resumeSpellDecorationsTimerRef = useRef<number | null>(null);
  const saveSel = () => {
    if (ref.current) keepSelectionOutOfSignature(ref.current);
    const s = window.getSelection();
    if (s && s.rangeCount && ref.current?.contains(s.anchorNode)) {
      savedRange.current = s.getRangeAt(0).cloneRange();
    }
  };
  const restoreSel = () => {
    const s = window.getSelection();
    if (savedRange.current && s) { s.removeAllRanges(); s.addRange(savedRange.current); }
  };

  const emitEditorState = () => {
    if (!ref.current) return;
    keepSelectionOutOfSignature(ref.current);
    setSignaturePresent(hasSignatureBlock(ref.current));
    onChange(getEditorCleanHtml(ref.current));
    setPlainText(ref.current.innerText || '');
  };

  const scheduleSpellDecorationsResume = () => {
    if (resumeSpellDecorationsTimerRef.current !== null) {
      window.clearTimeout(resumeSpellDecorationsTimerRef.current);
    }
    resumeSpellDecorationsTimerRef.current = window.setTimeout(() => {
      resumeSpellDecorationsTimerRef.current = null;
      setSpellDecorationsEnabled(true);
      emitEditorState();
    }, 180);
  };

  const exec = (cmd: string, value?: string) => {
    ref.current?.focus();
    try { document.execCommand('styleWithCSS', false, 'true'); } catch { /* noop */ }
    document.execCommand(cmd, false, value);
    emitEditorState();
  };
  const execFromControl = (cmd: string, value?: string) => {
    ref.current?.focus();
    restoreSel();
    exec(cmd, value);
  };

  const addLink = () => {
    const url = window.prompt('URL do link:', 'https://');
    if (url) exec('createLink', url);
  };

  const removeSignatureBlock = () => {
    const root = ref.current;
    if (!root) return;
    const signature = root.querySelector(`[${SIGNATURE_ATTR}]`);
    if (!signature) return;
    if (!window.confirm('Remover a assinatura somente desta mensagem?')) return;

    const prev = signature.previousElementSibling as HTMLElement | null;
    signature.remove();
    if (prev && prev.tagName === 'P' && !(prev.textContent || '').trim() && prev.querySelector('br')) {
      prev.remove();
    }
    root.focus();
    placeCaretBeforeSignature(root);
    emitEditorState();
  };

  const addSignatureBlock = () => {
    const root = ref.current;
    if (!root || !signatureHtml?.trim() || hasSignatureBlock(root)) return;
    const marker = root.querySelector('blockquote');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = buildSignatureBlockHtml(signatureHtml);
    while (wrapper.firstChild) {
      if (marker) root.insertBefore(wrapper.firstChild, marker);
      else root.appendChild(wrapper.firstChild);
    }
    root.focus();
    placeCaretBeforeSignature(root);
    emitEditorState();
  };

  const replaceCurrentMarkedWord = (replacement: string) => {
    if (!ref.current || !spellMenu) return;
    const marker = ref.current.querySelector(`[${SPELL_MARK_ID_ATTR}="${spellMenu.issueId}"]`) as HTMLSpanElement | null;
    if (!marker) return;

    const textNode = document.createTextNode(replacement);
    marker.replaceWith(textNode);
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    setSpellMenu(null);
    emitEditorState();
  };

  const ignoreCurrentWord = () => {
    if (!spellMenu) return;
    ignoredIssuesRef.current.add(spellMenu.ignoreKey);
    setSpellIssues((prev) => prev.filter((issue) => issue.ignoreKey !== spellMenu.ignoreKey));
    setSpellMenu(null);
  };

  const FONTS = [
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Calibri, Candara, Segoe, sans-serif', 'Calibri'],
    ['Georgia, "Times New Roman", serif', 'Georgia'],
    ['"Times New Roman", Times, serif', 'Times New Roman'],
    ['Verdana, Geneva, sans-serif', 'Verdana'],
    ['"Courier New", Courier, monospace', 'Courier New'],
  ];
  const SIZES = [['2', 'Pequena'], ['3', 'Normal'], ['4', 'Média'], ['5', 'Grande'], ['6', 'Enorme']];

  const Btn = ({ onClick, Icon, title }: { onClick: () => void; Icon: typeof Bold; title: string }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100">
      <Icon className="h-4 w-4" />
    </button>
  );
  const Sep = () => <span className="mx-1 h-5 w-px flex-none bg-[#e7e5df]" />;
  const selCls = 'h-7 rounded-md border border-[#e7e5df] bg-white px-1.5 text-[12px] text-zinc-600 outline-none hover:bg-zinc-50 focus:border-amber-400';

  return (
    <div className={`relative flex flex-col rounded-lg border border-[#e7e5df] focus-within:border-amber-400 ${fill ? 'min-h-0 flex-1' : ''}`}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#f0efe9] px-1.5 py-1.5">
        <div ref={aiPanelRef} className="relative">
          <button type="button" onClick={() => setAiOpen((v) => !v)} title="Escrever com IA"
            className="flex items-center gap-1 rounded p-1.5 text-amber-600 hover:bg-amber-50">
            <Sparkles className="h-4 w-4" />
          </button>
          {aiOpen && (
            <div className="absolute left-0 top-[calc(100%+6px)] z-[130] w-[340px] rounded-xl border border-[#eadfce] bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-zinc-800">
                <Sparkles className="h-4 w-4 text-amber-500" /> Escrever e-mail com IA
              </div>
              <div className="mb-2 flex gap-1">
                {([['formal', 'Formal'], ['cordial', 'Cordial'], ['direto', 'Direto']] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setAiTone(v)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${aiTone === v ? 'bg-amber-100 text-amber-800' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} autoFocus rows={3}
                placeholder="Descreva o que o e-mail deve dizer. Ex.: peça ao cliente o comprovante de residência atualizado até sexta-feira"
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void generateWithAi(); } }}
                className="w-full resize-none rounded-lg border border-[#e7e5df] px-2.5 py-2 text-[13px] outline-none placeholder:text-zinc-400 focus:border-amber-400" />
              <p className="mt-1.5 text-[11px] text-zinc-400">Substitui o corpo do e-mail (a assinatura é mantida).</p>
              {aiError && <p className="mt-1.5 text-[12px] text-red-600">{aiError}</p>}
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setAiOpen(false)} className="rounded-lg px-2.5 py-1.5 text-[12px] text-zinc-500 hover:bg-zinc-100">
                  Cancelar
                </button>
                <button type="button" onClick={() => void generateWithAi()} disabled={!aiPrompt.trim() || aiLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-amber-700 disabled:opacity-50">
                  {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Gerar e-mail
                </button>
              </div>
            </div>
          )}
        </div>
        <Sep />
        <select title="Fonte" className={`${selCls} w-[92px]`}
          onMouseDown={saveSel}
          onChange={(e) => { const v = e.target.value; e.currentTarget.selectedIndex = 0; if (v) execFromControl('fontName', v); }}>
          <option value="">Fonte</option>
          {FONTS.map(([v, label]) => <option key={v} value={v} style={{ fontFamily: v }}>{label}</option>)}
        </select>
        <select title="Tamanho" className={`${selCls} w-[78px]`}
          onMouseDown={saveSel}
          onChange={(e) => { const v = e.target.value; e.currentTarget.selectedIndex = 0; if (v) execFromControl('fontSize', v); }}>
          <option value="">Tam.</option>
          {SIZES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <Sep />

        <Btn onClick={() => exec('bold')} Icon={Bold} title="Negrito (Ctrl+B)" />
        <Btn onClick={() => exec('italic')} Icon={Italic} title="Itálico (Ctrl+I)" />
        <Btn onClick={() => exec('underline')} Icon={Underline} title="Sublinhado (Ctrl+U)" />
        <Btn onClick={() => exec('strikeThrough')} Icon={Strikethrough} title="Tachado" />
        <button type="button" title="Cor do texto" onMouseDown={(e) => { e.preventDefault(); saveSel(); }}
          onClick={() => colorRef.current?.click()} className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100">
          <Palette className="h-4 w-4" />
        </button>
        <input ref={colorRef} type="color" className="hidden"
          onChange={(e) => execFromControl('foreColor', e.target.value)} />
        <Sep />

        <Btn onClick={() => exec('justifyLeft')} Icon={AlignLeft} title="Alinhar à esquerda" />
        <Btn onClick={() => exec('justifyCenter')} Icon={AlignCenter} title="Centralizar" />
        <Btn onClick={() => exec('justifyRight')} Icon={AlignRight} title="Alinhar à direita" />
        <Sep />

        <Btn onClick={() => exec('insertUnorderedList')} Icon={List} title="Lista" />
        <Btn onClick={() => exec('insertOrderedList')} Icon={ListOrdered} title="Lista numerada" />
        <Btn onClick={() => exec('formatBlock', 'blockquote')} Icon={Quote} title="Citação" />
        <Btn onClick={addLink} Icon={Link2} title="Inserir link" />
        <Sep />

        <Btn onClick={() => exec('removeFormat')} Icon={RemoveFormatting} title="Limpar formatação" />
        <Btn onClick={() => fileRef.current?.click()} Icon={Paperclip} title="Anexar arquivo" />
        <input ref={fileRef} type="file" multiple className="hidden"
          onChange={(e) => { onAttach(e.target.files); e.target.value = ''; }} />
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} lang="pt-BR"
        autoCorrect="on" autoCapitalize="sentences"
        onInput={() => emitEditorState()}
        onKeyDown={(e) => {
          const lower = e.key.toLowerCase();
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && lower === 'z') {
            e.preventDefault();
            setSpellDecorationsEnabled(false);
            try { document.execCommand('undo'); } catch { /* noop */ }
            scheduleSpellDecorationsResume();
            return;
          }
          if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && lower === 'z') || lower === 'y')) {
            e.preventDefault();
            setSpellDecorationsEnabled(false);
            try { document.execCommand('redo'); } catch { /* noop */ }
            scheduleSpellDecorationsResume();
          }
        }}
        onKeyUp={saveSel} onMouseUp={saveSel} onBlur={saveSel}
        onFocus={() => { if (ref.current) keepSelectionOutOfSignature(ref.current); }}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.(`[${SIGNATURE_DELETE_ATTR}]`)) {
            e.preventDefault();
            e.stopPropagation();
            removeSignatureBlock();
            return;
          }
          if (target?.closest?.(`[${SIGNATURE_ATTR}]`)) {
            e.preventDefault();
            if (ref.current) {
              ref.current.focus();
              placeCaretBeforeSignature(ref.current);
            }
          }
        }}
        onContextMenu={(e) => {
          const marker = (e.target as HTMLElement).closest(`[${SPELL_MARK_ATTR}]`) as HTMLElement | null;
          if (!marker) return;
          e.preventDefault();
          e.stopPropagation();
          const issueId = marker.getAttribute(SPELL_MARK_ID_ATTR) || '';
          const ignoreKey = issueId;
          const word = marker.getAttribute(SPELL_MARK_ATTR) || marker.textContent || '';
          const label = marker.getAttribute('data-label') || word;
          const suggestions = (() => {
            try { return JSON.parse(marker.getAttribute('data-suggestions') || '[]') as string[]; } catch { return []; }
          })();
          setSpellMenu({
            x: Math.min(e.clientX, window.innerWidth - 260),
            y: Math.min(e.clientY + 6, window.innerHeight - 180),
            issueId,
            ignoreKey,
            word,
            label,
            suggestions,
          });
        }}
        style={{ fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '14px', lineHeight: 1.6, color: '#1f2937' }}
        className={`overflow-y-auto px-4 py-3 outline-none [&_a]:text-amber-700 [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-zinc-200 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500 [&_p]:mb-3.5 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-3.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-3.5 [&_li]:mb-1 ${fill ? 'min-h-[280px] flex-1' : 'min-h-[260px] max-h-[45vh]'}`} />
      {!signaturePresent && !!signatureHtml?.trim() && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addSignatureBlock}
          className="absolute bottom-3 right-3 z-[2] inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700 shadow-sm hover:bg-amber-100"
        >
          <span className="text-[14px] leading-none">+</span>
          <span>Adicionar assinatura</span>
        </button>
      )}
      {spellLoading && (
        <div className="pointer-events-none absolute right-3 top-[46px] rounded-full bg-white/95 px-2 py-1 text-[11px] font-medium text-zinc-500 shadow-sm ring-1 ring-[#ece7dc]">
          Revisando...
        </div>
      )}
      {spellMenu && (
        <div
          className="fixed z-[120] min-w-[220px] rounded-xl border border-[#eadfce] bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
          style={{ left: spellMenu.x, top: spellMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {spellMenu.suggestions.length > 0 ? spellMenu.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => replaceCurrentMarkedWord(suggestion)}
              className="block w-full rounded-lg px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-amber-50 hover:text-amber-900"
            >
              {suggestion}
            </button>
          )) : (
            <div className="px-3 py-2 text-[12px] text-zinc-500">Sem sugestão automática</div>
          )}
          <div className="px-3 pb-1 pt-0.5 text-[11px] text-zinc-400">{spellMenu.label}</div>
          <div className="my-1 h-px bg-[#f0efe9]" />
          <button
            type="button"
            onClick={ignoreCurrentWord}
            className="block w-full rounded-lg px-3 py-2 text-left text-[12px] text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700"
          >
            Ignorar nesta mensagem
          </button>
        </div>
      )}
    </div>
  );
}

// Campo de destinatários estilo webmail: chips por endereço, parsing por
// vírgula/ponto-e-vírgula/Enter, validação visual (inválido fica vermelho),
// Backspace remove o último. O valor externo continua sendo a string separada por
// vírgulas (compatível com o DTO/ponte), então nada muda no envio.
function RecipientChips({ value, onChange, placeholder, autoFocus, hasError }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; hasError?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const emails = parseRecipients(value);
  const setEmails = (list: string[]) => onChange(list.join(', '));
  const commitDraft = () => {
    const parts = parseRecipients(draft);
    if (parts.length) setEmails([...emails, ...parts]);
    setDraft('');
  };
  const removeAt = (i: number) => setEmails(emails.filter((_, j) => j !== i));

  return (
    <div className={`flex flex-wrap items-center gap-1 rounded-lg border px-2 py-1 focus-within:border-amber-400 ${hasError ? 'border-red-400 bg-red-50/40' : 'border-[#e7e5df]'}`}>
      {emails.map((e, i) => {
        const ok = isValidEmail(e);
        return (
          <span key={`${e}-${i}`} title={ok ? e : 'Endereço inválido'}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[13px] ${ok ? 'bg-zinc-100 text-zinc-700' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>
            {!ok && <AlertCircle className="h-3 w-3 flex-none" />}
            <span className="max-w-[220px] truncate">{e}</span>
            <button type="button" onClick={() => removeAt(i)} className="flex-none text-zinc-400 hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <input value={draft} autoFocus={autoFocus}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === ' ' && draft.includes('@'))) {
            e.preventDefault(); commitDraft();
          } else if (e.key === 'Backspace' && !draft && emails.length) {
            e.preventDefault(); removeAt(emails.length - 1);
          }
        }}
        onBlur={commitDraft}
        placeholder={emails.length ? '' : placeholder}
        className="min-w-[140px] flex-1 bg-transparent px-1 py-0.5 text-[14px] outline-none placeholder:text-zinc-400" />
    </div>
  );
}

// Esqueleto de carregamento da lista — substitui o spinner por linhas "fantasma"
// (sensação de webmail carregando, sem layout shift quando os dados chegam).
function EmailListSkeleton() {
  return (
    <div className="animate-pulse">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 border-b border-[#f0efe9] px-3 py-2.5 dark:border-zinc-800">
          <div className="h-8 w-8 flex-none rounded-full bg-zinc-200/70 dark:bg-zinc-700" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="h-2.5 w-28 rounded bg-zinc-200/70 dark:bg-zinc-700" />
              <div className="h-2.5 w-8 rounded bg-zinc-200/50 dark:bg-zinc-700/60" />
            </div>
            <div className="h-2.5 w-3/4 rounded bg-zinc-200/70 dark:bg-zinc-700" />
            <div className="h-2.5 w-1/2 rounded bg-zinc-200/40 dark:bg-zinc-700/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolBtn({ onClick, Icon, children, danger, active, compact, fill, title }: {
  onClick: () => void; Icon: typeof Reply; children?: React.ReactNode;
  danger?: boolean; active?: boolean; compact?: boolean; fill?: boolean; title?: string;
}) {
  return (
    <button onClick={onClick} title={compact ? (title ?? (typeof children === 'string' ? children : undefined)) : title}
      className={`flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-[12px] hover:bg-zinc-100 ${danger ? 'text-red-600 hover:bg-red-50' : active ? 'text-amber-500' : 'text-zinc-600'}`}>
      <Icon className="h-3.5 w-3.5" fill={fill ? 'currentColor' : 'none'} />{!compact && children}
    </button>
  );
}

interface ToolbarAction {
  key: string;
  label: string;
  Icon: typeof Reply;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  fill?: boolean;
}

/**
 * Barra de ações da leitura que SEMPRE cabe numa única linha. Quando o espaço
 * aperta (modal/coluna redimensionada), os botões viram "só ícone" — começando
 * pelo ÚLTIMO e indo até o primeiro (priority+). Uma cópia oculta mede a largura
 * natural de cada botão para decidir quantos colapsar, sem oscilar.
 */
function ReadingToolbar({ leading, actions }: { leading?: React.ReactNode; actions: ToolbarAction[] }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [compactCount, setCompactCount] = useState(0);
  const hasLeading = !!leading;

  const compute = useCallback(() => {
    const row = rowRef.current;
    const meas = measureRef.current;
    if (!row || !meas) return;
    const avail = row.clientWidth;
    const kids = Array.from(meas.children) as HTMLElement[];
    if (kids.length < 1) return;
    const GAP = 2; // gap-0.5
    const sample = kids[kids.length - 1]; // botão "só ícone" de referência
    const iconW = sample.offsetWidth;
    let i = 0;
    let leadingW = 0;
    if (hasLeading) { leadingW = kids[0]?.offsetWidth ?? 0; i = 1; }
    const fulls = kids.slice(i, kids.length - 1).map((el) => el.offsetWidth);
    const n = fulls.length;
    const visibleItems = n + (hasLeading ? 1 : 0);
    const gapsTotal = Math.max(0, visibleItems - 1) * GAP;

    let k = 0; // quantos (do fim) colapsar
    for (; k <= n; k++) {
      let used = leadingW + gapsTotal + k * iconW;
      for (let j = 0; j < n - k; j++) used += fulls[j];
      if (used <= avail - 2) break; // margem p/ não cortar o último rótulo
    }
    k = Math.min(k, n);
    setCompactCount((prev) => (prev === k ? prev : k));
  }, [hasLeading]);

  // Recalcula a cada render (rótulos mudam: estrela, lido/não lido…).
  useLayoutEffect(() => { compute(); });

  // Recalcula ao redimensionar a coluna/modal/janela.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => compute());
    ro.observe(row);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
  }, [compute]);

  const firstCompact = actions.length - compactCount;

  return (
    <div className="relative overflow-hidden border-b border-[#e7e5df] p-2 dark:border-zinc-800">
      <div ref={rowRef} className="flex flex-nowrap items-center gap-0.5">
        {leading}
        {actions.map((a, idx) => (
          <ToolBtn key={a.key} onClick={a.onClick} Icon={a.Icon} danger={a.danger}
            active={a.active} fill={a.fill} compact={idx >= firstCompact} title={a.label}>
            {a.label}
          </ToolBtn>
        ))}
      </div>

      {/* Cópia oculta para medição: todos expandidos + 1 amostra "só ícone". */}
      <div ref={measureRef} aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex items-center gap-0.5 whitespace-nowrap">
        {leading}
        {actions.map((a) => (
          <ToolBtn key={a.key} onClick={a.onClick} Icon={a.Icon} danger={a.danger} active={a.active} fill={a.fill} title={a.label}>
            {a.label}
          </ToolBtn>
        ))}
        <ToolBtn onClick={() => {}} Icon={Reply} compact title="medida" />
      </div>
    </div>
  );
}

function FormatBtn({ active, onClick, Icon, children }: { active: boolean; onClick: () => void; Icon: typeof Type; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] ${active ? 'bg-amber-100 font-medium text-amber-800' : 'text-zinc-500 hover:text-zinc-700'}`}>
      <Icon className="h-3.5 w-3.5" />{children}
    </button>
  );
}
