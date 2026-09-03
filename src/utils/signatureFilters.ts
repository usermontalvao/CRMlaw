import type { GeneratedDocument } from '../types/document.types';
import type { SignatureRequestWithSigners } from '../types/signature.types';
import { matchesNormalizedSearch, normalizeSearchText } from './search';
import { lerBuscaDeAssinatura, somenteDigitos } from './buscaDeAssinatura';

export interface SignatureFilterState {
  searchTerm: string;
  filterStatus: 'all' | 'pending' | 'signed' | 'expired';
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

  /*
    O QUE A BUSCA ALCANÇA.

    Ela procurava em DOIS campos: nome do documento e nome do cliente. Só que a
    página pública, quando o link quebra, mostra um código e manda a pessoa
    falar com o escritório — e colar aquele código aqui não achava nada. O
    código não tinha onde ser consultado.

    Agora o termo é LIDO antes de ser usado (ver `lerBuscaDeAssinatura`), e cada
    forma vai para o campo certo:

      · token (ou o link inteiro do WhatsApp) → `public_token` do signatário e
        o id da solicitação — busca EXATA, porque um UUID não se procura por
        pedaço;
      · dígitos → CPF e telefone dos signatários, comparados sem pontuação;
      · texto  → documento, cliente, e os nomes e e-mails de quem assina, mais
        o código do envelope.

    A busca por signatário é a que faltava no dia a dia: metade das perguntas do
    escritório começa por "a assinatura da fulana", e o nome dela nunca esteve
    no nome do arquivo.
  */
  const busca = lerBuscaDeAssinatura(filters.searchTerm);

  const out = requests.filter((req) => {
    const signatarios = req.signers ?? [];

    let matchesSearch: boolean;
    if (busca.tipo === 'vazio') {
      matchesSearch = true;
    } else if (busca.tipo === 'token') {
      matchesSearch =
        req.id.toLowerCase() === busca.token ||
        signatarios.some((s) => (s.public_token || '').toLowerCase() === busca.token);
    } else if (busca.tipo === 'digitos') {
      const alvo = busca.digitos as string;
      matchesSearch = signatarios.some(
        (s) => somenteDigitos(s.cpf).includes(alvo) || somenteDigitos(s.phone).includes(alvo),
      );
    } else {
      matchesSearch = matchesNormalizedSearch(filters.searchTerm, [
        req.document_name,
        req.client_name,
        (req as any).envelope_verification_code,
        ...signatarios.flatMap((s) => [s.name, s.email]),
      ]);
    }
    const expiresAt = (req as any).expires_at as string | null | undefined;
    const isExpired = expiresAt && new Date(expiresAt).getTime() < now && req.status !== 'signed';
    let matchesStatus: boolean;
    if (filters.filterStatus === 'all') {
      matchesStatus = true;
    } else if (filters.filterStatus === 'expired') {
      matchesStatus = Boolean(isExpired);
    } else {
      matchesStatus = req.status === filters.filterStatus && !isExpired;
    }
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

/**
 * Com termo digitado a pesquisa é GLOBAL: varre todas as pastas, não só a caixa
 * aberta. Sem termo, cada caixa mostra só o que está dentro dela.
 */
export const isGlobalSignatureSearch = (searchTerm: string) => normalizeSearchText(searchTerm).length > 0;

export const filterGeneratedDocumentsByFolder = (
  generatedDocuments: GeneratedDocument[],
  explorerItemIndex: Map<string, { folder_id?: string | null }>,
  searchTerm: string,
  selectedFolderId: string | null,
) => {
  const ignoreFolder = isGlobalSignatureSearch(searchTerm);

  return generatedDocuments.filter((doc) => {
    if (!ignoreFolder) {
      const item = explorerItemIndex.get(`generated_document:${doc.id}`);
      const folderId = item?.folder_id ?? null;
      if (folderId !== selectedFolderId) return false;
    }

    const matchesSearch = matchesNormalizedSearch(searchTerm, [doc.file_name, doc.client_name, doc.template_name]);
    return matchesSearch;
  });
};
