import React, { useEffect, useMemo, useRef, useState } from 'react';
import PizZip from 'pizzip';
import { Loader2 } from 'lucide-react';
import { templateFillService } from '../services/templateFill.service';
import type { CustomField, TemplateCustomField } from '../types/document.types';

interface PublicTemplateFillPageProps {
  token: string;
}

type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea' | 'currency' | 'name' | 'cpf' | 'phone' | 'cep';

type FieldDef = {
  placeholder: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  description?: string;
};

type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

const removeDiacritics = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC');

const normalizeKey = (value: string) => removeDiacritics((value || '').trim()).toUpperCase();

const ADDRESS_KEYS = new Set(['CEP', 'ENDERECO', 'NUMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'ESTADO']);

const ADDRESS_KEYS_VISIBLE = new Set(['CEP', 'ENDERECO', 'NUMERO', 'COMPLEMENTO', 'BAIRRO']);

const isNameKeyCandidate = (key: string) => {
  const k = normalizeKey(key);
  if (!k) return false;
  if (ADDRESS_KEYS.has(k)) return false;
  if (k === 'NCEP') return false;
  return true;
};

const addressLabelOverride = (field: FieldDef): string => {
  const k = normalizeKey(field.placeholder);
  if (k === 'COMPLEMENTO') return 'Quadra';
  return field.label;
};

const formatCep = (value: string) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const hasMinDigitsForField = (field: FieldDef, rawValue: string): boolean => {
  const digits = (rawValue || '').replace(/\D/g, '');
  if (field.type === 'cpf') return digits.length === 11 || digits.length === 14;
  if (field.type === 'phone') return digits.length === 10 || digits.length === 11;
  if (field.type === 'cep') return digits.length === 8;
  return true;
};

const formatCpfCnpj = (value: string) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    const p1 = digits.slice(0, 3);
    const p2 = digits.slice(3, 6);
    const p3 = digits.slice(6, 9);
    const p4 = digits.slice(9, 11);
    let out = p1;
    if (p2) out += `.${p2}`;
    if (p3) out += `.${p3}`;
    if (p4) out += `-${p4}`;
    return out;
  }

  const p1 = digits.slice(0, 2);
  const p2 = digits.slice(2, 5);
  const p3 = digits.slice(5, 8);
  const p4 = digits.slice(8, 12);
  const p5 = digits.slice(12, 14);
  let out = p1;
  if (p2) out += `.${p2}`;
  if (p3) out += `.${p3}`;
  if (p4) out += `/${p4}`;
  if (p5) out += `-${p5}`;
  return out;
};

const formatPhoneBR = (value: string) => {
  const digits = (value || '').replace(/\D/g, '').slice(0, 11);
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (!ddd) return rest;

  if (rest.length <= 4) return `(${ddd}) ${rest}`.trim();

  if (rest.length <= 8) {
    return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`.trim();
  }
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`.trim();
};

const BUILTIN: Array<{ placeholder: string; label: string }> = [
  { label: 'Nome completo', placeholder: 'NOME COMPLETO' },
  { label: 'Nacionalidade', placeholder: 'nacionalidade' },
  { label: 'Estado civil', placeholder: 'estado civil' },
  { label: 'Profissão', placeholder: 'profissão' },
  { label: 'CPF/CNPJ', placeholder: 'CPF' },
  { label: 'Endereço', placeholder: 'endereço' },
  { label: 'Número', placeholder: 'número' },
  { label: 'Complemento', placeholder: 'complemento' },
  { label: 'Bairro', placeholder: 'bairro' },
  { label: 'Cidade', placeholder: 'cidade' },
  { label: 'Estado', placeholder: 'estado' },
  { label: 'CEP', placeholder: 'CEP' },
  { label: 'Telefone', placeholder: 'telefone' },
  { label: 'Celular/WhatsApp', placeholder: 'celular' },
  { label: 'Réu/Parte contrária', placeholder: 'réu' },
  { label: 'Data', placeholder: 'data' },
];

const extractDocxPlaceholders = async (signedUrl: string): Promise<string[]> => {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`Falha ao baixar template: HTTP ${res.status}`);
  const ab = await res.arrayBuffer();
  const zip = new PizZip(ab);
  const xmlFiles = zip.file(/^word\/(document|header\d+|footer\d+)\.xml$/);
  const sources = (Array.isArray(xmlFiles) && xmlFiles.length > 0)
    ? xmlFiles
    : (() => {
        const doc = zip.file('word/document.xml');
        return doc ? [doc] : [];
      })();

  if (sources.length === 0) return [];

  const found = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;

  for (const file of sources) {
    const xml = file.asText();
    const text = xml
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = (m[1] || '').trim();
      if (!raw) continue;
      if (/^ASSINATURA(_\d+)?$/i.test(raw)) continue;
      found.add(raw);
    }
  }

  return Array.from(found);
};

const PublicTemplateFillPage: React.FC<PublicTemplateFillPageProps> = ({ token }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [bundle, setBundle] = useState<Awaited<ReturnType<typeof templateFillService.getBundle>> | null>(null);
  const [placeholders, setPlaceholders] = useState<string[]>([]);

  const [signerName, setSignerName] = useState('');

  const [values, setValues] = useState<Record<string, string>>({});

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ signerToken: string; requestId: string } | null>(null);

  const [cepLookupLoading, setCepLookupLoading] = useState(false);
  const [cepLookupError, setCepLookupError] = useState<string | null>(null);
  const lastCepLookupRef = useRef<string>('');

  const [cepConfirmed, setCepConfirmed] = useState<boolean | null>(null);
  const [hasQuadra, setHasQuadra] = useState<boolean | null>(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const activeInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const b = await templateFillService.getBundle(token);
        setBundle(b);
        setValues(b.prefill ?? {});

        const ph = await extractDocxPlaceholders(b.mainFile.signed_url);
        setPlaceholders(ph);
      } catch (e: any) {
        setError(e?.message || 'Erro ao carregar');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const fields = useMemo((): FieldDef[] => {
    if (!bundle) return [];

    const templateCustomByKey = new Map<string, TemplateCustomField>();
    for (const tcf of bundle.templateCustomFields ?? []) {
      templateCustomByKey.set(normalizeKey(tcf.placeholder), tcf);
    }

    const placeholderKeys = new Set(placeholders.map((p) => normalizeKey(p)));

    const configured = (bundle.templateCustomFields ?? [])
      .filter((tcf) => tcf.enabled !== false)
      .filter((tcf) => normalizeKey(tcf.placeholder) !== 'DATA')
      .filter((tcf) => placeholderKeys.has(normalizeKey(tcf.placeholder)))
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const customByKey = new Map<string, CustomField>();
    for (const cf of bundle.customFields ?? []) {
      customByKey.set(normalizeKey(cf.placeholder), cf);
    }

    const builtInByKey = new Map<string, { placeholder: string; label: string }>();
    for (const bi of BUILTIN) {
      builtInByKey.set(normalizeKey(bi.placeholder), bi);
    }

    const sourcePlaceholders: Array<{ placeholder: string; order: number }> =
      configured.length > 0
        ? configured.map((tcf) => ({ placeholder: tcf.placeholder, order: tcf.order ?? 0 }))
        : placeholders
            .filter((p) => normalizeKey(p) !== 'DATA')
            .map((p, idx) => ({ placeholder: p, order: idx }));

    const defs = sourcePlaceholders
      .map((src) => {
        const p = src.placeholder;
        const k = normalizeKey(p);
        if (k === 'DATA') return null;
        const tcf = templateCustomByKey.get(k);
        if (configured.length > 0 && !tcf) return null;
        if (tcf?.enabled === false) return null;

        const cf = customByKey.get(k);
        if (cf && cf.field_type !== 'signature') {
          return {
            placeholder: p,
            label: tcf?.name ?? cf.name,
            type: ((tcf?.field_type ?? cf.field_type) as FieldType) || 'text',
            required: tcf?.required ?? !!cf.required,
            options: (tcf?.options as any) ?? (cf.options as any) ?? undefined,
            description: (tcf?.description ?? cf.description) || undefined,
            __order: tcf?.order ?? src.order,
          } as FieldDef & { __order: number };
        }

        const bi = builtInByKey.get(k);
        if (bi) {
          return {
            placeholder: p,
            label: tcf?.name ?? bi.label,
            type: ((tcf?.field_type ?? (p.toLowerCase() === 'data' ? 'date' : 'text')) as FieldType) || 'text',
            required: tcf?.required ?? true,
            options: (tcf?.options as any) ?? undefined,
            description: (tcf?.description ?? undefined) as any,
            __order: tcf?.order ?? src.order,
          } as FieldDef & { __order: number };
        }

        return {
          placeholder: p,
          label: tcf?.name ?? p,
          type: ((tcf?.field_type ?? 'text') as FieldType) || 'text',
          required: tcf?.required ?? true,
          options: (tcf?.options as any) ?? undefined,
          description: (tcf?.description ?? undefined) as any,
          __order: tcf?.order ?? src.order,
        } as FieldDef & { __order: number };
      })
      .filter((d): d is (FieldDef & { __order: number }) => !!d);

    defs.sort((a: any, b: any) => (a.__order ?? 0) - (b.__order ?? 0));
    return defs.map((d: any) => {
      const { __order, ...rest } = d;
      return rest as FieldDef;
    });
  }, [bundle, placeholders]);

  const identityPlaceholders = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of fields) {
      map.set(normalizeKey(f.placeholder), f.placeholder);
    }

    const explicitName = fields.find((f) => f.type === 'name' && isNameKeyCandidate(f.placeholder))?.placeholder;
    const explicitCpf = fields.find((f) => f.type === 'cpf')?.placeholder;
    const explicitPhone = fields.find((f) => f.type === 'phone')?.placeholder;

    const name =
      explicitName ||
      (map.get('NOME COMPLETO') && isNameKeyCandidate(map.get('NOME COMPLETO') as string) ? map.get('NOME COMPLETO') : undefined) ||
      (map.get('NOME') && isNameKeyCandidate(map.get('NOME') as string) ? map.get('NOME') : undefined);
    const cpf = explicitCpf || map.get('CPF');
    const phone = explicitPhone || map.get('TELEFONE') || map.get('CELULAR');
    const email = map.get('EMAIL') || map.get('E-MAIL');

    return { name, cpf, phone, email };
  }, [fields]);

  const addressPlaceholders = useMemo(() => {
    const map = new Map<string, string>();
    const explicitCep = fields.find((f) => f.type === 'cep')?.placeholder;
    if (explicitCep) map.set('CEP', explicitCep);
    for (const f of fields) {
      const k = normalizeKey(f.placeholder);
      if (ADDRESS_KEYS.has(k)) {
        map.set(k, f.placeholder);
      }
    }
    return map;
  }, [fields]);

  const cepPlaceholder = addressPlaceholders.get('CEP');

  useEffect(() => {
    if (!cepPlaceholder) return;

    const digits = (values[cepPlaceholder] ?? '').replace(/\D/g, '');
    if (digits.length !== 8) {
      setCepLookupLoading(false);
      setCepLookupError(null);
      lastCepLookupRef.current = '';
      return;
    }

    if (digits === lastCepLookupRef.current) return;
    lastCepLookupRef.current = digits;

    (async () => {
      try {
        setCepLookupLoading(true);
        setCepLookupError(null);

        const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
        if (!res.ok) throw new Error(`Falha ao consultar CEP: HTTP ${res.status}`);

        const data = (await res.json()) as ViaCepResponse;
        if (data?.erro) {
          setCepLookupError('CEP não encontrado.');
          return;
        }

        setValues((prev) => {
          const next = { ...prev };

          const endereco = addressPlaceholders.get('ENDERECO');
          const bairro = addressPlaceholders.get('BAIRRO');
          const cidade = addressPlaceholders.get('CIDADE');
          const estado = addressPlaceholders.get('ESTADO');

          if (endereco && !(prev[endereco] || '').trim()) next[endereco] = data.logradouro || '';
          if (bairro && !(prev[bairro] || '').trim()) next[bairro] = data.bairro || '';
          if (cidade && !(prev[cidade] || '').trim()) next[cidade] = data.localidade || '';
          if (estado && !(prev[estado] || '').trim()) next[estado] = data.uf || '';

          return next;
        });
      } catch (e: any) {
        setCepLookupError(e?.message || 'Erro ao consultar CEP.');
      } finally {
        setCepLookupLoading(false);
      }
    })();
  }, [addressPlaceholders, cepPlaceholder, values]);

  type Step =
    | {
        kind: 'signer';
        id: 'signer_name';
        title: string;
        subtitle?: string;
        required: boolean;
      }
    | {
        kind: 'cep';
        id: 'cep';
        title: string;
        field: FieldDef;
      }
    | {
        kind: 'address_confirm';
        id: 'address_confirm';
        title: string;
      }
    | {
        kind: 'address_number';
        id: 'address_number';
        title: string;
        field: FieldDef;
      }
    | {
        kind: 'address_has_quadra';
        id: 'address_has_quadra';
        title: string;
      }
    | {
        kind: 'address_quadra';
        id: 'address_quadra';
        title: string;
        field: FieldDef;
      }
    | {
        kind: 'field';
        id: string;
        field: FieldDef;
      }
    | {
        kind: 'submit';
        id: 'submit';
      };

  const steps = useMemo<Step[]>(() => {
    const base: Step[] = [];

    if (!identityPlaceholders.name) {
      base.push({ kind: 'signer', id: 'signer_name', title: 'Qual é o seu nome completo?', required: true });
    }

    const addressFields = fields.filter((f) => ADDRESS_KEYS.has(normalizeKey(f.placeholder)));
    const visibleAddressFields = addressFields.filter((f) => ADDRESS_KEYS_VISIBLE.has(normalizeKey(f.placeholder)));
    const cepField = visibleAddressFields.find((f) => normalizeKey(f.placeholder) === 'CEP' || f.type === 'cep');
    const numberField = visibleAddressFields.find((f) => normalizeKey(f.placeholder) === 'NUMERO');
    const quadraField = visibleAddressFields.find((f) => normalizeKey(f.placeholder) === 'COMPLEMENTO');

    let addressInserted = false;

    for (const f of fields) {
      const k = normalizeKey(f.placeholder);
      const isAddress = ADDRESS_KEYS.has(k);

      if (isAddress) {
        if (!addressInserted && cepField) {
          base.push({ kind: 'cep', id: 'cep', title: 'CEP', field: cepField });
          base.push({ kind: 'address_confirm', id: 'address_confirm', title: 'Endereço encontrado' });
          if (numberField) {
            base.push({ kind: 'address_number', id: 'address_number', title: 'Número', field: numberField });
          }
          if (quadraField) {
            base.push({ kind: 'address_has_quadra', id: 'address_has_quadra', title: 'Tem quadra?' });
            base.push({ kind: 'address_quadra', id: 'address_quadra', title: 'Quadra', field: quadraField });
          }
          addressInserted = true;
        }
        continue;
      }

      base.push({ kind: 'field', id: `field:${normalizeKey(f.placeholder)}`, field: f });
    }

    base.push({ kind: 'submit', id: 'submit' });
    return base;
  }, [fields, identityPlaceholders.name]);

  const safeStepIndex = Math.max(0, Math.min(stepIndex, Math.max(0, steps.length - 1)));
  const activeStep = steps[safeStepIndex];

  useEffect(() => {
    if (!activeStep) return;
    if (activeStep.kind !== 'cep') return;
    if (cepLookupLoading || cepLookupError) return;
    const digits = (values[activeStep.field.placeholder] ?? '').replace(/\D/g, '');
    if (digits.length !== 8) return;
    if (safeStepIndex >= steps.length - 1) return;
    setStepError(null);
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }, [activeStep, cepLookupError, cepLookupLoading, safeStepIndex, steps.length, values]);

  const marketingProgress = useMemo(() => {
    const total = Math.max(1, steps.length);
    const maxIndex = Math.max(1, total - 1);
    const t = Math.min(1, Math.max(0, safeStepIndex / maxIndex));
    const eased = Math.pow(t, 0.6);
    const percent = total <= 1 ? 100 : Math.min(100, Math.max(8, Math.round(8 + eased * 92)));
    return { percent };
  }, [safeStepIndex, steps.length]);

  useEffect(() => {
    setStepError(null);
    const t = setTimeout(() => {
      activeInputRef.current?.focus?.();
    }, 0);
    return () => clearTimeout(t);
  }, [safeStepIndex]);

  const validateActiveStep = (): string | null => {
    if (!activeStep) return null;

    if (activeStep.kind === 'signer') {
      if (activeStep.id === 'signer_name' && !signerName.trim()) return 'Informe seu nome.';
      return null;
    }

    if (activeStep.kind === 'cep') {
      const v = (values[activeStep.field.placeholder] ?? '').trim();
      if (activeStep.field.required && !v) return 'Preencha este campo para continuar.';
      return null;
    }

    if (activeStep.kind === 'address_confirm') {
      if (cepConfirmed !== true) return 'Confirme o endereço para continuar.';
      return null;
    }

    if (activeStep.kind === 'address_number') {
      const v = (values[activeStep.field.placeholder] ?? '').trim();
      if (activeStep.field.required && !v) return 'Preencha este campo para continuar.';
      return null;
    }

    if (activeStep.kind === 'address_has_quadra') {
      if (hasQuadra === null) return 'Selecione uma opção para continuar.';
      return null;
    }

    if (activeStep.kind === 'address_quadra') {
      if (hasQuadra === false) return null;
      const v = (values[activeStep.field.placeholder] ?? '').trim();
      if (activeStep.field.required && !v) return 'Preencha este campo para continuar.';
      return null;
    }

    if (activeStep.kind === 'field') {
      const v = (values[activeStep.field.placeholder] ?? '').trim();
      if (activeStep.field.required) {
        if (!v) return 'Preencha este campo para continuar.';
        if (!hasMinDigitsForField(activeStep.field, v)) return 'Preencha este campo corretamente para continuar.';
      }
      return null;
    }

    return null;
  };

  const goNext = () => {
    const msg = validateActiveStep();
    if (msg) {
      setStepError(msg);
      return;
    }
    setStepError(null);

    if (activeStep?.kind === 'address_has_quadra' && hasQuadra === false) {
      setStepIndex((prev) => Math.min(prev + 2, steps.length - 1));
      return;
    }

    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  };

  const goBack = () => {
    setStepError(null);
    setStepIndex((prev) => Math.max(0, prev - 1));
  };

  const onKeyDownAdvance = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    if ((e.target as any)?.tagName?.toLowerCase?.() === 'textarea') return;
    e.preventDefault();
    goNext();
  };

  const addressPreview = useMemo(() => {
    const endereco = addressPlaceholders.get('ENDERECO') ? (values[addressPlaceholders.get('ENDERECO') as string] ?? '').trim() : '';
    const bairro = addressPlaceholders.get('BAIRRO') ? (values[addressPlaceholders.get('BAIRRO') as string] ?? '').trim() : '';
    const cidade = addressPlaceholders.get('CIDADE') ? (values[addressPlaceholders.get('CIDADE') as string] ?? '').trim() : '';
    const estado = addressPlaceholders.get('ESTADO') ? (values[addressPlaceholders.get('ESTADO') as string] ?? '').trim() : '';

    const parts = [endereco, bairro].filter(Boolean);
    const cityState = [cidade, estado].filter(Boolean).join(' - ');
    if (cityState) parts.push(cityState);
    return parts.join(', ');
  }, [addressPlaceholders, values]);

  const signatureUrl = result ? `${window.location.origin}/#/assinar/${result.signerToken}` : '';

  useEffect(() => {
    if (!result?.signerToken) return;
    window.location.href = `${window.location.origin}/#/assinar/${result.signerToken}`;
  }, [result]);

  const submitNow = async () => {
    if (!bundle) return;

    const missing = fields.filter((f) => {
      if (!f.required) return false;
      const k = normalizeKey(f.placeholder);
      if (k === 'CIDADE' || k === 'ESTADO') return false;
      if (k === 'COMPLEMENTO' && hasQuadra === false) return false;
      const v = (values[f.placeholder] || '').trim();
      if (!v) return true;
      if (!hasMinDigitsForField(f, v)) return true;
      return false;
    });
    const nameToSend = identityPlaceholders.name
      ? (values[identityPlaceholders.name] || '').trim()
      : signerName.trim();
    const emailToSend = identityPlaceholders.email ? (values[identityPlaceholders.email] || '').trim() : '';

    if (!nameToSend || missing.length > 0) {
      setError('Preencha os campos obrigatórios.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const today = new Date().toLocaleDateString('pt-BR');
      const payloadValues: Record<string, string> = { ...values };

      const allPlaceholders = (bundle.templateCustomFields ?? []).map((tcf) => tcf.placeholder);
      const fillTargets = allPlaceholders.length > 0 ? allPlaceholders : placeholders;
      for (const p of fillTargets) {
        if (normalizeKey(p) === 'DATA') {
          payloadValues[p] = today;
        }
      }

      const byKey = new Map<string, string>();
      for (const [k, v] of Object.entries(payloadValues)) {
        byKey.set(normalizeKey(k), (v ?? '').toString());
      }
      const detectedPhone = (byKey.get('TELEFONE') || byKey.get('CELULAR') || '').trim();
      const phoneToSend = (identityPlaceholders.phone ? (values[identityPlaceholders.phone] || '').trim() : '') || detectedPhone || null;

      const cpfToSend = (identityPlaceholders.cpf ? (values[identityPlaceholders.cpf] || '').trim() : '') || null;

      const res = await templateFillService.submit({
        token,
        signer: {
          name: nameToSend,
          email: emailToSend || null,
          cpf: cpfToSend,
          phone: phoneToSend,
        },
        values: payloadValues,
      });

      setResult({ signerToken: res.signer_token, requestId: res.signature_request_id });
    } catch (e: any) {
      setError(e?.message || 'Erro ao enviar');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitNow();
  };

  useEffect(() => {
    if (!activeStep) return;
    if (activeStep.kind !== 'submit') return;
    if (submitting || result) return;
    submitNow();
  }, [activeStep, submitting, result]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 max-w-sm w-full">
          <p className="text-sm font-medium text-slate-900">Link indisponível</p>
          <p className="mt-1 text-xs text-slate-500">{error || 'Não foi possível carregar.'}</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
              <p className="text-sm font-medium text-slate-900">Redirecionando para assinatura...</p>
            </div>
            <p className="mt-2 text-xs text-slate-600">Se não redirecionar automaticamente, abra:</p>
            <a href={signatureUrl} className="mt-2 inline-block text-xs text-orange-700 underline">
              {signatureUrl}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-base font-medium text-slate-900">{bundle.template.name}</h1>
          <p className="mt-1 text-xs text-slate-600">
            Responda 1 pergunta por vez. Ao finalizar, você receberá o link de assinatura.
          </p>
        </div>

        <div className="mb-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
            <span>Progresso</span>
            <span>{marketingProgress.percent}%</span>
          </div>
          <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 transition-all duration-300" 
              style={{ width: `${marketingProgress.percent}%` }} 
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          {(error || stepError) && (
            <div className="mb-4 bg-rose-50 border border-rose-200 rounded p-3 text-xs text-rose-700">
              {stepError || error}
            </div>
          )}

          {(cepLookupLoading || cepLookupError) && (
            <div className={`mb-4 border rounded p-3 text-xs ${cepLookupError ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
              {cepLookupError ? cepLookupError : 'Buscando endereço pelo CEP...'}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {activeStep.kind === 'submit' ? (
              <div>
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                  <p className="text-sm font-medium text-slate-900">Gerando documento...</p>
                </div>
                <p className="mt-2 text-xs text-slate-600">Aguarde, estamos preparando o link de assinatura.</p>
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={submitting}
                    className="w-full px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50 disabled:opacity-40"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : activeStep.kind === 'signer' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">{activeStep.title}</p>
                {activeStep.subtitle && <p className="text-xs text-slate-600 mb-4">{activeStep.subtitle}</p>}

                <div className="mb-4">
                  {activeStep.id === 'signer_name' && (
                    <input
                      ref={(el) => {
                        activeInputRef.current = el;
                      }}
                      value={signerName}
                      onKeyDown={onKeyDownAdvance}
                      onChange={(e) => setSignerName(e.target.value.toUpperCase())}
                      className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder="Ex: João da Silva"
                    />
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={safeStepIndex === 0}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50 disabled:opacity-40"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Próximo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500 text-center">Pressione Enter para avançar</p>
              </div>
            ) : activeStep.kind === 'cep' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">CEP *</p>

                <div className="mb-4">
                  <input
                    ref={(el) => {
                      activeInputRef.current = el;
                    }}
                    type="text"
                    value={values[activeStep.field.placeholder] ?? ''}
                    onKeyDown={onKeyDownAdvance}
                    onChange={(e) => {
                      setCepConfirmed(null);
                      setHasQuadra(null);
                      setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: formatCep(e.target.value) }));
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    placeholder="00000-000"
                    inputMode="numeric"
                  />
                  <p className="mt-2 text-xs text-slate-500">Digite o CEP para buscarmos o endereço automaticamente.</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={safeStepIndex === 0}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50 disabled:opacity-40"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Próximo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500 text-center">Pressione Enter para avançar</p>
              </div>
            ) : activeStep.kind === 'address_confirm' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">Endereço correto?</p>

                <div className="mb-4 border border-slate-200 rounded p-3 bg-slate-50">
                  <p className="text-xs text-slate-600">{addressPreview || 'Endereço não localizado automaticamente.'}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCepConfirmed(false);
                      setStepError(null);
                      setStepIndex((prev) => Math.max(0, prev - 1));
                    }}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCepConfirmed(true);
                      setStepError(null);
                      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
                    }}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Sim
                  </button>
                </div>
              </div>
            ) : activeStep.kind === 'address_number' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">Número *</p>

                <div className="mb-4">
                  <input
                    ref={(el) => {
                      activeInputRef.current = el;
                    }}
                    type="text"
                    value={values[activeStep.field.placeholder] ?? ''}
                    onKeyDown={onKeyDownAdvance}
                    onChange={(e) => setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Próximo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500 text-center">Pressione Enter para avançar</p>
              </div>
            ) : activeStep.kind === 'address_has_quadra' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">Tem quadra?</p>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setHasQuadra(false);
                      setStepError(null);
                      setStepIndex((prev) => Math.min(prev + 2, steps.length - 1));
                    }}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHasQuadra(true);
                      setStepError(null);
                      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
                    }}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Sim
                  </button>
                </div>
              </div>
            ) : activeStep.kind === 'address_quadra' ? (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">Quadra</p>

                <div className="mb-4">
                  <input
                    ref={(el) => {
                      activeInputRef.current = el;
                    }}
                    type="text"
                    value={values[activeStep.field.placeholder] ?? ''}
                    onKeyDown={onKeyDownAdvance}
                    onChange={(e) => setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Próximo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500 text-center">Pressione Enter para avançar</p>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium text-slate-900 mb-2">{activeStep.field.label}</p>

                <div className="mb-4">
                  {activeStep.field.type === 'textarea' ? (
                    <textarea
                      ref={(el) => {
                        activeInputRef.current = el;
                      }}
                      value={values[activeStep.field.placeholder] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: e.target.value }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
                      rows={3}
                    />
                  ) : activeStep.field.type === 'select' ? (
                    <div className="space-y-2">
                      {(activeStep.field.options ?? []).map((o: { value: string; label: string }) => {
                        const selected = (values[activeStep.field.placeholder] ?? '') === o.value;
                        return (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => {
                              setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: o.value }));
                              setStepError(null);
                              setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
                            }}
                            className={`w-full text-left px-3 py-2 rounded border text-sm transition ${selected ? 'border-orange-600 bg-orange-50 text-orange-900' : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'}`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      ref={(el) => {
                        activeInputRef.current = el;
                      }}
                      type={activeStep.field.type === 'date' ? 'date' : activeStep.field.type === 'number' ? 'number' : 'text'}
                      value={values[activeStep.field.placeholder] ?? ''}
                      onKeyDown={onKeyDownAdvance}
                      onChange={(e) => {
                        const isCep = activeStep.field.type === 'cep' || normalizeKey(activeStep.field.placeholder) === 'CEP';
                        const isCpf = activeStep.field.type === 'cpf';
                        const isPhone = activeStep.field.type === 'phone';
                        const isName = activeStep.field.type === 'name';
                        const nextValue = isCep
                          ? formatCep(e.target.value)
                          : isCpf
                            ? formatCpfCnpj(e.target.value)
                            : isPhone
                              ? formatPhoneBR(e.target.value)
                              : isName
                                ? e.target.value.toUpperCase()
                                : e.target.value;
                        setValues((prev) => ({ ...prev, [activeStep.field.placeholder]: nextValue }));
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      placeholder={activeStep.field.type === 'cep' || normalizeKey(activeStep.field.placeholder) === 'CEP' ? '00000-000' : ''}
                      inputMode={
                        activeStep.field.type === 'cep' || activeStep.field.type === 'cpf' || activeStep.field.type === 'phone'
                          ? 'numeric'
                          : undefined
                      }
                    />
                  )}

                  {activeStep.field.description && (
                    <p className="mt-2 text-xs text-slate-500">{activeStep.field.description}</p>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={goBack}
                    className="flex-1 px-3 py-2 border border-slate-200 bg-white text-slate-700 text-xs font-medium rounded hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                  <button
                    type="button"
                    onClick={goNext}
                    className="flex-1 px-3 py-2 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-500"
                  >
                    Próximo
                  </button>
                </div>

                <p className="mt-3 text-xs text-slate-500 text-center">Pressione Enter para avançar</p>
              </div>
            )}
          </form>
        </div>

        <p className="mt-4 text-xs text-slate-400 text-center">Jurius · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
};

export default PublicTemplateFillPage;
