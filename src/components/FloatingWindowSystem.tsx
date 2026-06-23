import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Calendar, Clock, Layers, Newspaper, Users, Scale, Briefcase,
  FileText, PiggyBank, Bell, Library, PenTool, Cloud, MessageCircle,
  MessageSquare, Mail, Settings, UserCog, Target,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FloatingModuleKey =
  | 'dashboard' | 'feed' | 'clientes' | 'processos' | 'requerimentos'
  | 'peticoes' | 'financeiro' | 'prazos' | 'agenda' | 'intimacoes'
  | 'documentos' | 'assinaturas' | 'cloud' | 'chat' | 'whatsapp'
  | 'email' | 'configuracoes' | 'leads';

export interface FloatingWin {
  id: string;
  module: FloatingModuleKey;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  restore?: { x: number; y: number; width: number; height: number };
  zIndex: number;
}

interface FloatingWindowSystemProps {
  windows: FloatingWin[];
  onUpdate: (id: string, patch: Partial<FloatingWin>) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  renderModule: (module: FloatingModuleKey) => React.ReactNode;
}

const MIN_W = 400;
const MIN_H = 300;
const TASKBAR_H = 44;

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// Janelas ficam entre z-45 e z-65 — abaixo dos popovers/modais internos (z-70+)
const Z_MIN = 45;
const Z_MAX = 65;

// ── Metadados dos módulos ─────────────────────────────────────────────────────

export const MODULE_META: Record<FloatingModuleKey, { title: string; icon: React.ReactNode; iconBg: string }> = {
  dashboard:     { title: 'Dashboard',    icon: <Layers className="h-3.5 w-3.5" />,       iconBg: '#6366f1' },
  feed:          { title: 'Feed',         icon: <Newspaper className="h-3.5 w-3.5" />,     iconBg: '#8b5cf6' },
  leads:         { title: 'Leads',        icon: <Target className="h-3.5 w-3.5" />,        iconBg: '#f59e0b' },
  agenda:        { title: 'Agenda',       icon: <Calendar className="h-3.5 w-3.5" />,      iconBg: '#f59e0b' },
  chat:          { title: 'Chat',         icon: <MessageCircle className="h-3.5 w-3.5" />, iconBg: '#10b981' },
  whatsapp:      { title: 'WhatsApp',     icon: <MessageSquare className="h-3.5 w-3.5" />, iconBg: '#22c55e' },
  email:         { title: 'Email',        icon: <Mail className="h-3.5 w-3.5" />,          iconBg: '#3b82f6' },
  clientes:      { title: 'Clientes',     icon: <Users className="h-3.5 w-3.5" />,         iconBg: '#14b8a6' },
  processos:     { title: 'Processos',    icon: <Scale className="h-3.5 w-3.5" />,         iconBg: '#6366f1' },
  requerimentos: { title: 'Requerimentos',icon: <Briefcase className="h-3.5 w-3.5" />,     iconBg: '#7c3aed' },
  peticoes:      { title: 'Petições',     icon: <FileText className="h-3.5 w-3.5" />,      iconBg: '#64748b' },
  financeiro:    { title: 'Financeiro',   icon: <PiggyBank className="h-3.5 w-3.5" />,     iconBg: '#22c55e' },
  prazos:        { title: 'Prazos',       icon: <Clock className="h-3.5 w-3.5" />,         iconBg: '#f97316' },
  intimacoes:    { title: 'Intimações',   icon: <Bell className="h-3.5 w-3.5" />,          iconBg: '#ef4444' },
  documentos:    { title: 'Documentos',   icon: <Library className="h-3.5 w-3.5" />,       iconBg: '#eab308' },
  assinaturas:   { title: 'Assinaturas',  icon: <PenTool className="h-3.5 w-3.5" />,       iconBg: '#ec4899' },
  cloud:         { title: 'Cloud',        icon: <Cloud className="h-3.5 w-3.5" />,         iconBg: '#0ea5e9' },
  configuracoes: { title: 'Configurações',icon: <Settings className="h-3.5 w-3.5" />,      iconBg: '#78716c' },
};

// ── SVG icons estilo Windows 11 ───────────────────────────────────────────────

const WinMinimize = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
  </svg>
);
const WinMaximize = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
);
const WinRestore = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
    <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="white" />
    <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" fill="none" />
  </svg>
);
const WinClose = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" strokeWidth="1.1" />
    <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

// ── FloatingWindow ────────────────────────────────────────────────────────────

interface WinProps {
  win: FloatingWin;
  onUpdate: (patch: Partial<FloatingWin>) => void;
  onClose: () => void;
  onFocus: () => void;
  renderModule: (module: FloatingModuleKey) => React.ReactNode;
  isTop: boolean;
}

function FloatingWindow({ win, onUpdate, onClose, onFocus, renderModule, isTop }: WinProps) {
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);
  const meta = MODULE_META[win.module];

  const winRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Aplica estilo direto no DOM durante drag/resize — evita re-renders e lag nos modais
  const applyStyle = (patch: { x?: number; y?: number; width?: number; height?: number }) => {
    const el = winRef.current;
    if (!el) return;
    if (patch.x !== undefined) el.style.left = `${patch.x}px`;
    if (patch.y !== undefined) el.style.top = `${patch.y}px`;
    if (patch.width !== undefined) el.style.width = `${patch.width}px`;
    if (patch.height !== undefined) el.style.height = `${patch.height}px`;
  };

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if (win.maximized || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    onFocus();
    const start = { sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y };
    let last = { x: win.x, y: win.y };
    const move = (ev: MouseEvent) => {
      last = { x: Math.max(0, start.ox + ev.clientX - start.sx), y: Math.max(0, start.oy + ev.clientY - start.sy) };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; applyStyle(last); });
    };
    const up = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      onUpdate(last);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [win.maximized, win.x, win.y, onFocus, onUpdate]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent, dir: ResizeDir) => {
    if (win.maximized) return;
    e.preventDefault(); e.stopPropagation(); onFocus();
    const start = { sx: e.clientX, sy: e.clientY, ox: win.x, oy: win.y, ow: win.width, oh: win.height };
    let last = { x: win.x, y: win.y, width: win.width, height: win.height };
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - start.sx, dy = ev.clientY - start.sy;
      let { ox: x, oy: y, ow: w, oh: h } = start;
      if (dir.includes('e')) w = Math.max(MIN_W, w + dx);
      if (dir.includes('s')) h = Math.max(MIN_H, h + dy);
      if (dir.includes('w')) { const nw = Math.max(MIN_W, w - dx); x = x + w - nw; w = nw; }
      if (dir.includes('n')) { const nh = Math.max(MIN_H, h - dy); y = y + h - nh; h = nh; }
      last = { x, y, width: w, height: h };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => { rafRef.current = null; applyStyle(last); });
    };
    const up = () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      onUpdate(last);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, [win.maximized, win.x, win.y, win.width, win.height, onFocus, onUpdate]);

  const toggleMax = useCallback((e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (win.maximized) {
      onUpdate({ maximized: false, ...(win.restore ?? {}) });
    } else {
      onUpdate({ maximized: true, restore: { x: win.x, y: win.y, width: win.width, height: win.height }, x: 0, y: 0, width: window.innerWidth, height: window.innerHeight - TASKBAR_H });
    }
  }, [win, onUpdate]);

  const style: React.CSSProperties = win.minimized ? { display: 'none' } : win.maximized
    ? { position: 'fixed', left: 0, top: 0, right: 0, bottom: TASKBAR_H, zIndex: win.zIndex }
    : { position: 'fixed', left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex };

  const titlebarBg = isTop ? '#323232' : '#3c3c3c';

  // Memoiza o conteúdo do módulo — evita re-render durante drag/resize
  const moduleContent = useMemo(() => renderModule(win.module), [win.module, renderModule]);

  return (
    <div
      ref={winRef}
      style={{ ...style, border: isTop ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.35)' }}
      className={`flex flex-col overflow-hidden shadow-2xl ${win.maximized ? '' : 'rounded-lg'}`}
      onMouseDown={onFocus}
    >
      {/* Title bar Windows 11 */}
      <div
        style={{ background: titlebarBg, height: 32, flexShrink: 0 }}
        className="flex items-center select-none"
        onMouseDown={onTitleMouseDown}
        onDoubleClick={toggleMax}
      >
        <div className="flex items-center gap-2 px-3 flex-1 min-w-0">
          <span className="flex h-4 w-4 flex-none items-center justify-center rounded-sm text-white" style={{ background: meta.iconBg }}>
            {meta.icon}
          </span>
          <span className="truncate text-[12px] text-white/80 font-normal pointer-events-none">{win.title}</span>
        </div>

        <div className="flex h-full flex-none">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onUpdate({ minimized: true, maximized: false }); }}
            className="flex h-full w-11 items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            title="Minimizar"
          ><WinMinimize /></button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={toggleMax}
            className="flex h-full w-11 items-center justify-center text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            title={win.maximized ? 'Restaurar' : 'Maximizar'}
          >{win.maximized ? <WinRestore /> : <WinMaximize />}</button>
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="flex h-full w-11 items-center justify-center text-white/70 hover:bg-[#c42b1c] hover:text-white transition-colors"
            style={{ borderRadius: win.maximized ? 0 : '0 6px 0 0' }}
            title="Fechar"
          ><WinClose /></button>
        </div>
      </div>

      {/* Content */}
      <div
        style={{ containerType: 'inline-size', containerName: 'fw' } as React.CSSProperties}
        className="fw-content flex-1 min-h-0 overflow-auto bg-[#f5f5f3]"
      >
        {moduleContent}
      </div>

      {/* Resize handles */}
      {!win.maximized && (
        <>
          <div className="absolute top-0 left-4 right-4 h-[4px] cursor-n-resize z-10"  onMouseDown={(e) => onResizeMouseDown(e, 'n')} />
          <div className="absolute bottom-0 left-4 right-4 h-[4px] cursor-s-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 's')} />
          <div className="absolute left-0 top-4 bottom-4 w-[4px] cursor-w-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'w')} />
          <div className="absolute right-0 top-4 bottom-4 w-[4px] cursor-e-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'e')} />
          <div className="absolute top-0 left-0 h-4 w-4 cursor-nw-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'nw')} />
          <div className="absolute top-0 right-0 h-4 w-4 cursor-ne-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'ne')} />
          <div className="absolute bottom-0 left-0 h-4 w-4 cursor-sw-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'sw')} />
          <div className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize z-10" onMouseDown={(e) => onResizeMouseDown(e, 'se')} />
        </>
      )}
    </div>
  );
}

// ── Taskbar Windows 11 ────────────────────────────────────────────────────────

function tileWindows(windows: FloatingWin[], onUpdate: (id: string, patch: Partial<FloatingWin>) => void) {
  const open = windows.filter(w => !w.minimized);
  if (open.length === 0) return;
  const W = window.innerWidth;
  const H = window.innerHeight - TASKBAR_H;
  const n = open.length;
  if (n === 1) {
    onUpdate(open[0].id, { x: 0, y: 0, width: W, height: H, maximized: false });
  } else if (n === 2) {
    const hw = Math.floor(W / 2);
    onUpdate(open[0].id, { x: 0,  y: 0, width: hw,     height: H, maximized: false });
    onUpdate(open[1].id, { x: hw, y: 0, width: W - hw, height: H, maximized: false });
  } else if (n === 3) {
    const hw = Math.floor(W / 2); const hh = Math.floor(H / 2);
    onUpdate(open[0].id, { x: 0,  y: 0,  width: hw,     height: H,      maximized: false });
    onUpdate(open[1].id, { x: hw, y: 0,  width: W - hw, height: hh,     maximized: false });
    onUpdate(open[2].id, { x: hw, y: hh, width: W - hw, height: H - hh, maximized: false });
  } else {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const ww = Math.floor(W / cols); const wh = Math.floor(H / rows);
    open.forEach((w, i) => {
      const col = i % cols; const row = Math.floor(i / cols);
      onUpdate(w.id, { x: col * ww, y: row * wh, width: ww, height: wh, maximized: false });
    });
  }
}

function Taskbar({ windows, onRestore, onClose, onFocus, onUpdate, maxZ }: {
  windows: FloatingWin[];
  onRestore: (id: string) => void;
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onUpdate: (id: string, patch: Partial<FloatingWin>) => void;
  maxZ: number;
}) {
  if (windows.length === 0) return null;
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9999] flex items-center gap-1 px-2"
      style={{ height: TASKBAR_H, background: '#1f1f1f', borderTop: '1px solid rgba(255,255,255,0.08)' }}
    >
      {/* Botão organizador */}
      <button
        onClick={() => tileWindows(windows, onUpdate)}
        title="Organizar janelas"
        className="flex h-8 w-8 flex-none items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white/90 transition-colors mr-1"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="0.5" y="0.5" width="5.5" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
          <rect x="8" y="0.5" width="5.5" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
          <rect x="0.5" y="7.5" width="5.5" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
          <rect x="8" y="7.5" width="5.5" height="6" rx="1" stroke="currentColor" strokeWidth="1"/>
        </svg>
      </button>
      <div className="w-px h-5 bg-white/10 mr-1 flex-none" />

      {windows.map((w) => {
        const meta = MODULE_META[w.module];
        const active = !w.minimized;
        const isFocused = active && w.zIndex === maxZ;
        return (
          <div
            key={w.id}
            onClick={() => {
              if (w.minimized) { onRestore(w.id); }
              else if (isFocused) { onUpdate(w.id, { minimized: true }); }
              else { onFocus(w.id); }
            }}
            className="relative flex items-center gap-2 px-3 h-8 rounded cursor-pointer transition-colors max-w-[200px] group"
            style={{ background: isFocused ? 'rgba(255,255,255,0.12)' : active ? 'rgba(255,255,255,0.06)' : 'transparent' }}
          >
            <span className="flex h-4 w-4 flex-none items-center justify-center rounded-sm text-white" style={{ background: meta.iconBg }}>
              {meta.icon}
            </span>
            <span className="truncate text-[12px] text-white/75 font-normal">{w.title}</span>
            <button
              className="ml-1 flex-none text-white/30 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onClose(w.id); }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <line x1="0.5" y1="0.5" x2="7.5" y2="7.5" stroke="currentColor" strokeWidth="1.2"/>
                <line x1="7.5" y1="0.5" x2="0.5" y2="7.5" stroke="currentColor" strokeWidth="1.2"/>
              </svg>
            </button>
            {active && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-4 rounded-full bg-white/60" />}
          </div>
        );
      })}
    </div>
  );
}

// ── FloatingWindowSystem ──────────────────────────────────────────────────────

export function FloatingWindowSystem({ windows, onUpdate, onClose, onFocus, renderModule }: FloatingWindowSystemProps) {
  const maxZ = Math.max(...windows.map(w => w.zIndex), 0);
  return (
    <>
      {windows.map((w) => (
        <FloatingWindow
          key={w.id}
          win={w}
          isTop={w.zIndex === maxZ}
          onUpdate={(patch) => onUpdate(w.id, patch)}
          onClose={() => onClose(w.id)}
          onFocus={() => onFocus(w.id)}
          renderModule={renderModule}
        />
      ))}
      <Taskbar
        windows={windows}
        maxZ={maxZ}
        onRestore={(id) => { onUpdate(id, { minimized: false }); onFocus(id); }}
        onClose={onClose}
        onFocus={onFocus}
        onUpdate={onUpdate}
      />
    </>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFloatingWindows() {
  const [windows, setWindows] = useState<FloatingWin[]>([]);

  const openWindow = useCallback((module: FloatingModuleKey, title: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.module === module);
      if (existing) {
        return prev.map((w) => w.id === existing.id
          ? { ...w, minimized: false, zIndex: Z_MAX }
          : { ...w, zIndex: w.zIndex > Z_MIN ? w.zIndex - 1 : Z_MIN });
      }
      const offset = (prev.length % 8) * 30;
      const newWin: FloatingWin = {
        id: `${module}-${Date.now()}`, module, title,
        x: 100 + offset, y: 70 + offset,
        width: 920, height: 600,
        minimized: false, maximized: false, zIndex: Z_MAX,
      };
      return [...prev.map((w) => ({ ...w, zIndex: w.zIndex > Z_MIN ? w.zIndex - 1 : Z_MIN })), newWin];
    });
  }, []);

  const updateWindow = useCallback((id: string, patch: Partial<FloatingWin>) => {
    setWindows((prev) => prev.map((w) => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find(w => w.id === id);
      if (!target || target.zIndex === Z_MAX) return prev;
      return prev.map((w) => w.id === id
        ? { ...w, zIndex: Z_MAX }
        : { ...w, zIndex: w.zIndex > Z_MIN ? w.zIndex - 1 : Z_MIN });
    });
  }, []);

  return { windows, openWindow, updateWindow, closeWindow, focusWindow };
}
