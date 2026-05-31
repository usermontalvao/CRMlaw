/**
 * Utilitários compartilhados das páginas do Portal
 */
import React from 'react';

// ----------------------------------------------------------------------------
// Formatadores
// ----------------------------------------------------------------------------

export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

/**
 * Converte string em Date tratando datas-só ("YYYY-MM-DD") como LOCAIS
 * (evita o off-by-one de fuso: new Date('2026-01-27') vira 26/01 em UTC-3/-4).
 */
function parseDate(date: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(date);
}

export function formatDate(date: string | null | undefined, opts?: { withTime?: boolean }): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  return opts?.withTime
    ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR');
}

export function formatDateLong(date: string | null | undefined): string {
  if (!date) return '—';
  const d = parseDate(date);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatRelative(date: string | null | undefined): string {
  if (!date) return '—';
  const d = new Date(date).getTime();
  if (isNaN(d)) return '—';
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (Math.abs(sec) < 60) return 'agora mesmo';
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return `há ${Math.abs(min)} min`;
  const hr = Math.round(min / 60);
  if (Math.abs(hr) < 24) return `há ${Math.abs(hr)}h`;
  const day = Math.round(hr / 24);
  if (Math.abs(day) < 30) return `há ${Math.abs(day)} dia${Math.abs(day) > 1 ? 's' : ''}`;
  return formatDate(date);
}

export function formatCPF(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return cpf;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return phone;
}

export function formatFileSize(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ----------------------------------------------------------------------------
// Page header
// ----------------------------------------------------------------------------

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, icon: Icon, actions }) => (
  <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex items-start gap-3">
      {Icon && (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-50 to-amber-50 text-orange-600 ring-1 ring-orange-100">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

// ----------------------------------------------------------------------------
// Empty state
// ----------------------------------------------------------------------------

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/60 px-6 py-12 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
      <Icon className="h-7 w-7" />
    </div>
    <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
    {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

// ----------------------------------------------------------------------------
// Loading skeleton
// ----------------------------------------------------------------------------

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-2xl border border-slate-200/80 bg-white p-5 ${className}`}>
    <div className="h-3 w-24 rounded bg-slate-200" />
    <div className="mt-3 h-7 w-32 rounded bg-slate-200" />
    <div className="mt-4 h-2 w-full rounded bg-slate-100" />
    <div className="mt-2 h-2 w-3/4 rounded bg-slate-100" />
  </div>
);

export const PageLoader: React.FC<{ message?: string }> = ({ message = 'Carregando...' }) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard />
    <span className="sr-only">{message}</span>
  </div>
);

// ----------------------------------------------------------------------------
// Badges
// ----------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  // financeiro
  pago: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pendente: 'bg-amber-50 text-amber-700 ring-amber-200',
  vencido: 'bg-rose-50 text-rose-700 ring-rose-200',
  atrasado: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelado: 'bg-slate-100 text-slate-600 ring-slate-200',
  // processo
  ativo: 'bg-blue-50 text-blue-700 ring-blue-200',
  arquivado: 'bg-slate-100 text-slate-600 ring-slate-200',
  suspenso: 'bg-amber-50 text-amber-700 ring-amber-200',
  // assinatura
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  signed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  expired: 'bg-slate-100 text-slate-600 ring-slate-200',
  cumprido: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const STATUS_LABELS: Record<string, string> = {
  pago: 'Pago',
  pendente: 'Pendente',
  vencido: 'Vencido',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
  ativo: 'Ativo',
  arquivado: 'Arquivado',
  suspenso: 'Suspenso',
  pending: 'Aguardando',
  in_progress: 'Em andamento',
  signed: 'Assinado',
  expired: 'Expirado',
  cumprido: 'Cumprido',
};

export const StatusBadge: React.FC<{ status: string; label?: string }> = ({ status, label }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
      STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 ring-slate-200'
    }`}
  >
    {label || STATUS_LABELS[status] || status}
  </span>
);
