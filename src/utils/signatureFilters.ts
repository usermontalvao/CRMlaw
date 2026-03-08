import type { GeneratedDocument } from '../types/document.types';
import type { SignatureRequestWithSigners } from '../types/signature.types';
import { matchesNormalizedSearch } from './search';

export interface SignatureFilterState {
  searchTerm: string;
  filterStatus: 'all' | 'pending' | 'signed';
  filterPeriod: 'all' | '7d' | '30d' | '90d';
  filterMonth: string;
  filterDateFrom: string;
  filterDateTo: string;
  sortOrder: 'newest' | 'oldest';
}

export const filterSignatureRequests = (
  requests: SignatureRequestWithSigners[],
  filters: SignatureFilterState,
) => {
  const now = Date.now();
  const fromMs = filters.filterDateFrom ? new Date(`${filters.filterDateFrom}T00:00:00`).getTime() : null;
  const toMs = filters.filterDateTo ? new Date(`${filters.filterDateTo}T23:59:59`).getTime() : null;
  const periodMs =
    filters.filterPeriod === '7d'
      ? 7 * 24 * 60 * 60 * 1000
      : filters.filterPeriod === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : filters.filterPeriod === '90d'
          ? 90 * 24 * 60 * 60 * 1000
          : 0;

  const out = requests.filter((req) => {
    const matchesSearch = matchesNormalizedSearch(filters.searchTerm, [req.document_name, req.client_name]);
    const matchesStatus = filters.filterStatus === 'all' || req.status === filters.filterStatus;
    const matchesPeriod = periodMs === 0 || (now - new Date(req.created_at).getTime() <= periodMs);

    const createdAt = new Date(req.created_at);
    const createdMs = createdAt.getTime();

    const matchesMonth = !filters.filterMonth || req.created_at.slice(0, 7) === filters.filterMonth;
    const matchesDateFrom = fromMs === null || createdMs >= fromMs;
    const matchesDateTo = toMs === null || createdMs <= toMs;

    return matchesSearch && matchesStatus && matchesPeriod && matchesMonth && matchesDateFrom && matchesDateTo;
  });

  out.sort((a, b) => {
    const aT = new Date(a.created_at).getTime();
    const bT = new Date(b.created_at).getTime();
    return filters.sortOrder === 'newest' ? bT - aT : aT - bT;
  });

  return out;
};

export const filterGeneratedDocumentsByFolder = (
  generatedDocuments: GeneratedDocument[],
  explorerItemIndex: Map<string, { folder_id?: string | null }>,
  searchTerm: string,
  selectedFolderId: string | null,
) => {
  return generatedDocuments.filter((doc) => {
    const item = explorerItemIndex.get(`generated_document:${doc.id}`);
    const folderId = item?.folder_id ?? null;
    if (folderId !== selectedFolderId) return false;

    const matchesSearch = matchesNormalizedSearch(searchTerm, [doc.file_name, doc.client_name, doc.template_name]);
    return matchesSearch;
  });
};
