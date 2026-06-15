// ── Configuração global de formatação (carregada de system_settings.preferences) ──
interface FormatterConfig {
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
  currency: string;   // ISO 4217, ex: 'BRL', 'USD', 'EUR'
  locale: string;     // BCP 47, ex: 'pt-BR'
}

const CURRENCY_LOCALE: Record<string, string> = {
  BRL: 'pt-BR',
  USD: 'en-US',
  EUR: 'de-DE',
};

let _cfg: FormatterConfig = {
  dateFormat: 'DD/MM/YYYY',
  currency: 'BRL',
  locale: 'pt-BR',
};

/** Atualiza a configuração global de formatação (chamado uma vez no mount do App). */
export const setFormatterPrefs = (prefs: { date_format?: string; currency?: string }) => {
  const fmt = (prefs.date_format as FormatterConfig['dateFormat']) || 'DD/MM/YYYY';
  const cur = prefs.currency || 'BRL';
  _cfg = {
    dateFormat: fmt,
    currency: cur,
    locale: CURRENCY_LOCALE[cur] || 'pt-BR',
  };
};

/** Carrega as preferências do banco e aplica globalmente. Chame uma vez no App.tsx. */
export const loadFormatterPrefs = async (): Promise<void> => {
  try {
    const { settingsService } = await import('../services/settings.service');
    const prefs = await settingsService.getPreferences();
    setFormatterPrefs(prefs);
  } catch {
    // mantém defaults
  }
};

/**
 * Formata um valor numérico como moeda (respeita a configuração global de moeda).
 */
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat(_cfg.locale, {
    style: 'currency',
    currency: _cfg.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Formata um valor numérico como moeda sem centavos.
 */
export const formatCurrencyShort = (value: number): string => {
  return new Intl.NumberFormat(_cfg.locale, {
    style: 'currency',
    currency: _cfg.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * Formata uma data respeitando o formato configurado em Preferências.
 * Aceita string ISO (YYYY-MM-DD ou com hora) ou objeto Date.
 */
export const formatDate = (date: Date | string | null | undefined): string => {
  if (!date) return '—';
  let yyyy: string, mm: string, dd: string;

  if (typeof date === 'string') {
    const raw = date.trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      [yyyy, mm, dd] = datePart.split('-');
    } else {
      const d = new Date(raw);
      if (isNaN(d.getTime())) return raw;
      yyyy = d.getFullYear().toString();
      mm   = String(d.getMonth() + 1).padStart(2, '0');
      dd   = String(d.getDate()).padStart(2, '0');
    }
  } else {
    yyyy = date.getFullYear().toString();
    mm   = String(date.getMonth() + 1).padStart(2, '0');
    dd   = String(date.getDate()).padStart(2, '0');
  }

  switch (_cfg.dateFormat) {
    case 'MM/DD/YYYY': return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    default:           return `${dd}/${mm}/${yyyy}`;
  }
};

/**
 * Formata uma data com hora (data usa o formato configurado, hora sempre HH:MM).
 */
export const formatDateTime = (date: Date | string | null | undefined): string => {
  if (!date) return '—';
  if (typeof date === 'string') {
    const raw = date.trim();
    if (raw.includes('T')) {
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `${formatDate(d)} ${time}`;
      }
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return formatDate(raw);
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `${formatDate(d)} ${time}`;
    }
    return raw;
  }
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(date)} ${time}`;
};

/**
 * Formata apenas a hora
 */
export const formatTime = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

/**
 * Formata data por extenso
 */
export const formatDateLong = (date: Date | string): string => {
  let d: Date;
  if (typeof date === 'string') {
    const raw = date.trim();
    const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [yyyy, mm, dd] = datePart.split('-').map((x) => Number(x));
      d = new Date(yyyy, mm - 1, dd);
    } else {
      d = new Date(raw);
    }
  } else {
    d = date;
  }

  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};

/**
 * Retorna saudação baseada na hora do dia
 */
export const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bom dia';
  if (hour < 18) return 'Boa tarde';
  return 'Boa noite';
};

/**
 * Calcula diferença em dias entre duas datas
 */
export const getDaysDiff = (date1: Date, date2: Date = new Date()): number => {
  const diffTime = date1.getTime() - date2.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

/**
 * Verifica se uma data é hoje
 */
export const isToday = (date: Date | string): boolean => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toDateString() === new Date().toDateString();
};

/**
 * Verifica se uma data é amanhã
 */
export const isTomorrow = (date: Date | string): boolean => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString();
};

/**
 * Trunca texto com ellipsis
 */
export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
};

/**
 * Formata número de telefone brasileiro
 */
export const formatPhone = (phone: string): string => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
};

/**
 * Formata CPF
 */
export const formatCPF = (cpf: string): string => {
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return cpf;
  return `${cleaned.slice(0, 3)}.${cleaned.slice(3, 6)}.${cleaned.slice(6, 9)}-${cleaned.slice(9)}`;
};

/**
 * Máscara incremental de CPF para inputs (000.000.000-00)
 */
export const maskCpfInput = (value: string): string => {
  const numbers = value.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 6) return `${numbers.slice(0, 3)}.${numbers.slice(3)}`;
  if (numbers.length <= 9) return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6)}`;
  return `${numbers.slice(0, 3)}.${numbers.slice(3, 6)}.${numbers.slice(6, 9)}-${numbers.slice(9)}`;
};

/**
 * Formata CNPJ
 */
export const formatCNPJ = (cnpj: string): string => {
  const cleaned = cnpj.replace(/\D/g, '');
  if (cleaned.length !== 14) return cnpj;
  return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 5)}.${cleaned.slice(5, 8)}/${cleaned.slice(8, 12)}-${cleaned.slice(12)}`;
};
