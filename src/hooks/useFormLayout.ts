import { useState, useEffect } from 'react';
import { settingsService, type FormFieldConfig } from '../services/settings.service';

interface FormLayoutHelpers {
  isHidden:   (fieldKey: string) => boolean;
  isRequired: (fieldKey: string) => boolean;
  fieldLabel: (fieldKey: string, fallback: string) => string;
  ready: boolean;
}

const cache: Record<string, Record<string, FormFieldConfig>> = {};

export function useFormLayout(moduleKey: string): FormLayoutHelpers {
  const [fields, setFields] = useState<Record<string, FormFieldConfig>>(cache[moduleKey] ?? {});
  const [ready, setReady] = useState(!!cache[moduleKey]);

  useEffect(() => {
    if (cache[moduleKey]) { setFields(cache[moduleKey]); setReady(true); return; }
    settingsService.getFormLayouts().then(layouts => {
      const m = layouts.find(l => l.module_key === moduleKey);
      const map = Object.fromEntries((m?.fields ?? []).map(f => [f.field_key, f]));
      cache[moduleKey] = map;
      setFields(map);
      setReady(true);
    }).catch(() => { setReady(true); });
  }, [moduleKey]);

  return {
    isHidden:   (key) => fields[key]?.hidden   ?? false,
    isRequired: (key) => fields[key]?.required ?? false,
    fieldLabel: (key, fallback) => fields[key]?.label ?? fallback,
    ready,
  };
}
