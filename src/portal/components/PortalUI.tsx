import React from 'react';

export function formatCurrency(value: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function parseDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(date);
}

export function formatDate(date: string | null | undefined, opts?: { withTime?: boolean }): string {
  if (!date) return '—';
  const parsed = parseDate(date);
  if (isNaN(parsed.getTime())) return '—';
  return opts?.withTime
    ? parsed.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : parsed.toLocaleDateString('pt-BR');
}

export function formatDateLong(date: string | null | undefined): string {
  if (!date) return '—';
  const parsed = parseDate(date);
  if (isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatRelative(date: string | null | undefined): string {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (isNaN(parsed)) return '—';
  const diffSeconds = Math.round((Date.now() - parsed) / 1000);
  if (Math.abs(diffSeconds) < 60) return 'agora mesmo';
  const minutes = Math.round(diffSeconds / 60);
  if (Math.abs(minutes) < 60) return `há ${Math.abs(minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `há ${Math.abs(hours)}h`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `há ${Math.abs(days)} dia${Math.abs(days) > 1 ? 's' : ''}`;
  return formatDate(date);
}

export function formatCPF(cpf: string | null | undefined): string {
  if (!cpf) return '—';
  const digits = cpf.replace(/\D/g, '');
  if (digits.length !== 11) return cpf;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return phone;
}

export function formatFileSize(bytes: number | null | undefined): string {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[20px] bg-[linear-gradient(135deg,#fff7ed,#ffedd5)] text-orange-700 ring-1 ring-orange-200 shadow-[0_10px_20px_rgba(249,115,22,0.10)]">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <div>
        <h1 className="text-[29px] font-extrabold tracking-tight text-slate-900 sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm leading-relaxed text-slate-500">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-[30px] border border-white/70 bg-white/72 px-6 py-12 text-center shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur-xl">
    <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-[linear-gradient(135deg,#fff7ed,#f8fafc)] text-orange-500 ring-1 ring-orange-100">
      <Icon className="h-7 w-7" />
    </div>
    <h3 className="mt-4 text-base font-semibold text-slate-900">{title}</h3>
    {description && <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const SkeletonCard: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`animate-pulse rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-[0_18px_36px_rgba(15,23,42,0.06)] backdrop-blur-xl ${className}`}>
    <div className="h-3 w-24 rounded-full bg-slate-200" />
    <div className="mt-3 h-8 w-32 rounded-2xl bg-slate-200" />
    <div className="mt-4 h-2.5 w-full rounded-full bg-slate-100" />
    <div className="mt-2 h-2.5 w-3/4 rounded-full bg-slate-100" />
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

const STATUS_COLORS: Record<string, string> = {
  pago: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  pendente: 'bg-amber-50 text-amber-700 ring-amber-200',
  vencido: 'bg-rose-50 text-rose-700 ring-rose-200',
  atrasado: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelado: 'bg-slate-100 text-slate-600 ring-slate-200',
  ativo: 'bg-blue-50 text-blue-700 ring-blue-200',
  arquivado: 'bg-slate-100 text-slate-600 ring-slate-200',
  suspenso: 'bg-amber-50 text-amber-700 ring-amber-200',
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
    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
      STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 ring-slate-200'
    }`}
  >
    {label || STATUS_LABELS[status] || status}
  </span>
);
