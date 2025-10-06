import { djeService } from './dje.service';
import type { ProcessPracticeArea } from '../types/process.types';

const formatDate = (date: Date) => date.toISOString().split('T')[0];

const PRACTICE_AREA_KEYWORDS: Record<ProcessPracticeArea, RegExp[]> = {
  trabalhista: [/trabalhista/i, /reclamante/i, /reclamado/i, /trt/i, /vara do trabalho/i],
  familia: [/fam[ií]lia/i, /guarda/i, /alimentos/i, /paternidade/i],
  consumidor: [/consumidor/i, /cdc/i, /concession[áa]ria/i, /telefonia/i],
  previdenciario: [/previdenci[áa]rio/i, /inss/i, /aposentadoria/i, /benef[ií]cio/i],
  civel: [/c[ií]vel/i, /indeniza/i, /contrat/i, /obrig/i],
};

const sanitizeProcessCode = (value: string) => value.replace(/\D/g, '');

const guessPracticeArea = (text: string): ProcessPracticeArea | null => {
  const lowerText = text.toLowerCase();
  for (const [area, patterns] of Object.entries(PRACTICE_AREA_KEYWORDS) as [ProcessPracticeArea, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(lowerText))) {
      return area;
    }
  }
  return null;
};

const extractCourt = (publication: any): string | null => {
  if (publication?.orgaoJulgador) return String(publication.orgaoJulgador);
  if (publication?.unidadeJudiciaria) return String(publication.unidadeJudiciaria);
  if (publication?.unidade) return String(publication.unidade);

  const content: string = publication?.conteudo ?? '';
  const courtMatch = content.match(/vara[\w\s\-ºª\/]+/i);
  if (courtMatch) {
    return courtMatch[0].trim().replace(/\s+/g, ' ');
  }
  return null;
};

export interface ProcessLookupResult {
  court?: string | null;
  practice_area?: ProcessPracticeArea | null;
  distributed_at?: string | null;
}

export interface ProcessLookupOptions {
  startDate?: string;
  endDate?: string;
}

export const processLookupService = {
  async lookupProcessDetails(processCode: string, options?: ProcessLookupOptions): Promise<ProcessLookupResult | null> {
    const sanitized = sanitizeProcessCode(processCode);
    if (!sanitized) {
      throw new Error('Informe um número de processo válido.');
    }

    const end = options?.endDate ?? formatDate(new Date());
    const start = options?.startDate ?? formatDate(new Date(new Date().setMonth(new Date().getMonth() - 6)));

    const publications = await djeService.fetchPublications(sanitized, start, end);
    if (!publications.length) {
      return null;
    }

    const latest = publications[0];
    const content = String(latest.conteudo ?? '');
    const combinedSources = [
      latest.assunto,
      latest.classe,
      latest.subclasse,
      latest.orgaoJulgador,
      content,
    ]
      .filter(Boolean)
      .join(' ');

    const court = extractCourt(latest);
    const practiceArea = guessPracticeArea(combinedSources);
    const distributedAt = latest.dataDisponibilizacao ?? latest.dataPublicacao ?? null;

    return {
      court: court ?? null,
      practice_area: practiceArea ?? null,
      distributed_at: distributedAt,
    };
  },
};
