import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, KeyRound, Loader2, Search,
  Plus, RefreshCw, Share2, Trash2, UserMinus, Users, X,
} from 'lucide-react';
import {
  authenticatorService,
  type VaultCredentialSummary,
  type VaultShareSummary,
} from '../services/authenticator.service';
import { zc } from '../styles/layers';
import AuthenticatorCredentialAccessModal from './AuthenticatorCredentialAccessModal';
import AuthenticatorCreateCredentialModal from './AuthenticatorCreateCredentialModal';

type UserResult = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
};

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

export const AuthenticatorCredentialsManagerModal: React.FC<{
  credentials: VaultCredentialSummary[];
  canCreate: boolean;
  canManage: boolean;
  canDelete: boolean;
  onClose: () => void;
  onChanged: (change: 'created' | 'shared' | 'revoked' | 'deleted', credentialIds: string[]) => void | Promise<void>;
  sharesLoader?: () => Promise<{ shares: VaultShareSummary[] }>;
}> = ({ credentials, canCreate, canManage, canDelete, onClose, onChanged, sharesLoader = () => authenticatorService.listShares() }) => {
  const [activeTab, setActiveTab] = useState<'mine' | 'shared'>('mine');
  const [creating, setCreating] = useState(false);
  const [openedCredential, setOpenedCredential] = useState<VaultCredentialSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [bulkSharing, setBulkSharing] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [level, setLevel] = useState<'USE' | 'MANAGE'>('USE');
  const [searching, setSearching] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [shares, setShares] = useState<VaultShareSummary[]>([]);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [sharesLoaded, setSharesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; type: 'ok' | 'error' } | null>(null);

  const mine = useMemo(
    () => credentials
      .filter((credential) => credential.is_owner)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [credentials],
  );

  const combina = (credential: VaultCredentialSummary, term: string) =>
    !term || `${credential.name} ${credential.issuer ?? ''} ${credential.owner_name ?? ''}`
      .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(term);

  const termoBusca = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const visible = useMemo(
    () => mine.filter((credential) => combina(credential, termoBusca)),
    [mine, termoBusca],
  );

  /**
   * As chaves que compartilharam COM esta pessoa.
   *
   * Faltavam na tela inteira: quem s\u00f3 tem USE via "Minhas chaves 0" e o convite
   * para adicionar a primeira chave, enquanto usava treze todos os dias. A
   * lista dizia respeito ao que a pessoa ADMINISTRA, n\u00e3o ao que ela tem \u2014 e
   * quem recebeu uma chave tem a chave.
   *
   * Ficam numa se\u00e7\u00e3o pr\u00f3pria, sem caixa de sele\u00e7\u00e3o: as a\u00e7\u00f5es em lote s\u00e3o
   * compartilhar e excluir, e nenhuma das duas se aplica a uma chave de outra
   * pessoa. O que se pode fazer aqui \u00e9 sair dela.
   */
  const recebidas = useMemo(
    () => credentials
      .filter((credential) => !credential.is_owner)
      .filter((credential) => combina(credential, termoBusca))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [credentials, termoBusca],
  );

  const selectedCredentials = useMemo(
    () => mine.filter((credential) => selectedIds.has(credential.id)),
    [mine, selectedIds],
  );
  const allVisibleSelected = visible.length > 0 && visible.every((credential) => selectedIds.has(credential.id));
  const canShareSelection = selectedCredentials.length > 0
    && selectedCredentials.every((credential) => canManage && credential.can_manage);
  const canDeleteSelection = selectedCredentials.length > 0
    && selectedCredentials.every((credential) => canDelete && credential.is_owner);

  const sharedGroups = useMemo(() => {
    const term = query.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const groups = new Map<string, { credential: VaultCredentialSummary | null; name: string; issuer: string | null; ownerName: string | null; shares: VaultShareSummary[] }>();
    for (const share of shares) {
      const haystack = `${share.credential_name} ${share.credential_issuer ?? ''} ${share.owner_name ?? ''} ${share.name ?? ''} ${share.email ?? ''}`
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (term && !haystack.includes(term)) continue;
      const current = groups.get(share.credential_id) ?? {
        credential: credentials.find((credential) => credential.id === share.credential_id) ?? null,
        name: share.credential_name,
        issuer: share.credential_issuer,
        ownerName: share.owner_name,
        shares: [],
      };
      current.shares.push(share);
      groups.set(share.credential_id, current);
    }
    return [...groups.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [credentials, query, shares]);
  const sharedCredentialCount = useMemo(
    () => new Set(shares.map((share) => share.credential_id)).size,
    [shares],
  );

  const notify = (message: string, type: 'ok' | 'error' = 'ok') => {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 3200);
  };

  /**
   * Uma tentativa automática, e só uma.
   *
   * `sharesLoaded` marca SUCESSO, então ele não serve de freio: quando a
   * chamada falhava, ele continuava `false`, o efeito abaixo via "ainda não
   * carregou, não está carregando" e pedia de novo — e de novo, e de novo. Em
   * produção deu cinco chamadas em menos de dois segundos, para sempre, com a
   * tela presa em "Carregando acessos…" e a mensagem de erro nunca aparecendo.
   *
   * Esta ref registra que a tentativa ACONTECEU, dando ou não certo. Falhou,
   * o erro aparece na tela e quem quiser tentar de novo usa o botão de
   * atualizar, que zera a marca — repetir sozinho é decisão de quem está
   * olhando, não do componente.
   */
  const tentouCarregarShares = useRef(false);

  /**
   * Sair de uma chave que compartilharam comigo.
   *
   * Pede confirmação porque é irreversível do lado de cá: quem sai não se
   * reconvida — o acesso volta a depender de o dono compartilhar de novo. E a
   * chave em si não é tocada; some da lista de quem saiu, e mais nada.
   */
  const sairDaChave = async (credential: VaultCredentialSummary) => {
    if (!window.confirm(
      `Sair de "${credential.name}"?\n\nVocê deixa de gerar os códigos desta chave. `
      + `A chave NÃO é excluída — ela continua com ${credential.owner_name ?? 'o proprietário'}, `
      + 'que precisará compartilhá-la de novo se você voltar a precisar.',
    )) return;
    setProcessing(true);
    try {
      await authenticatorService.leaveShare(credential.id);
      notify(`Você saiu de "${credential.name}".`);
      await onChanged('revoked', [credential.id]);
    } catch (cause: any) {
      notify(cause?.message ?? 'Não foi possível sair desta chave.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const loadShares = async () => {
    tentouCarregarShares.current = true;
    setSharesLoading(true);
    setError(null);
    try {
      const result = await sharesLoader();
      setShares(result.shares);
      setSharesLoaded(true);
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível carregar os compartilhamentos.');
    } finally {
      setSharesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'shared' && canManage && !sharesLoaded && !sharesLoading && !tentouCarregarShares.current) {
      void loadShares();
    }
  }, [activeTab, canManage, sharesLoaded, sharesLoading]);

  const toggleOne = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visible.forEach((credential) => next.delete(credential.id));
      else visible.forEach((credential) => next.add(credential.id));
      return next;
    });
  };

  useEffect(() => {
    if (!bulkSharing) return;
    const term = userQuery.trim();
    setSelectedUser(null);
    if (term.length < 2) { setUsers([]); setSearching(false); return; }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      authenticatorService.searchUsers(term)
        .then(({ users: found }) => {
          if (cancelled) return;
          const ownerIds = new Set(selectedCredentials.map((credential) => credential.owner_user_id));
          setUsers(found.filter((user) => !ownerIds.has(user.user_id)));
        })
        .catch((cause: any) => { if (!cancelled) setError(cause?.message ?? 'Não foi possível buscar usuários.'); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [bulkSharing, selectedCredentials, userQuery]);

  /**
   * O lote vai numa chamada só — e isso é decisão de PRODUTO, não de rede.
   *
   * Uma chamada por chave fazia o backend avisar uma vez por chave: doze chaves
   * compartilhadas de uma vez chegavam do outro lado como doze notificações e
   * doze e-mails. O laço saiu daqui para o backend, que conhece a lista inteira
   * e manda um recado só, com todos os nomes.
   */
  const shareSelected = async () => {
    if (!selectedUser || !canShareSelection) return;
    setProcessing(true);
    setError(null);

    const ids = selectedCredentials.map((credential) => credential.id);
    let failed: string[] = [];
    let succeeded: string[] = [];
    try {
      const resultado = await authenticatorService.shareMany(ids, selectedUser.user_id, level);
      failed = resultado.failed ?? [];
      succeeded = ids.filter((id) => !failed.includes(id));
    } catch (cause: any) {
      setProcessing(false);
      setError(cause?.message ?? 'Não foi possível compartilhar as chaves.');
      return;
    }

    if (succeeded.length > 0) await onChanged('shared', succeeded);
    setProcessing(false);
    if (failed.length > 0) {
      setSelectedIds(new Set(failed));
      setError(`${succeeded.length} chave(s) compartilhada(s), mas ${failed.length} falharam. As que falharam continuam selecionadas.`);
      return;
    }
    notify(`${succeeded.length} chave(s) compartilhada(s) com ${selectedUser.name}.`);
    setSelectedIds(new Set());
    setBulkSharing(false);
    setUserQuery('');
    setUsers([]);
    setSelectedUser(null);
    setLevel('USE');
  };

  const deleteSelected = async () => {
    if (!canDeleteSelection) return;
    const total = selectedCredentials.length;
    if (!window.confirm(`Excluir ${total} chave(s) do cofre?\n\nTodas deixarão de gerar códigos e sumirão para TODAS as pessoas com quem foram compartilhadas.`)) return;

    setProcessing(true);
    setError(null);
    const succeeded: string[] = [];
    const failed: string[] = [];
    for (const credential of selectedCredentials) {
      try {
        await authenticatorService.remove(credential.id, 'Excluída em lote pelo proprietário no CRM.');
        succeeded.push(credential.id);
      } catch {
        failed.push(credential.id);
      }
    }
    if (succeeded.length > 0) await onChanged('deleted', succeeded);
    setProcessing(false);
    setSelectedIds(new Set(failed));
    if (failed.length > 0) {
      setError(`${succeeded.length} chave(s) excluída(s), mas ${failed.length} falharam. As que falharam continuam selecionadas.`);
    } else {
      notify(`${succeeded.length} chave(s) excluída(s) para todos os usuários.`);
    }
  };

  const revokeShares = async (targets: VaultShareSummary[], scope: 'one' | 'key' | 'all') => {
    if (targets.length === 0 || processing) return;
    const question = scope === 'one'
      ? `Revogar o acesso de ${targets[0].name ?? targets[0].email ?? 'este usuário'} à chave “${targets[0].credential_name}”?`
      : scope === 'key'
        ? `Revogar os ${targets.length} acesso(s) concedidos à chave “${targets[0].credential_name}”?`
        : `Revogar todos os ${targets.length} compartilhamento(s) exibidos?`;
    if (!window.confirm(`${question}\n\nA chave NÃO será excluída. Ela continuará no cofre do proprietário.`)) return;

    setProcessing(true);
    setError(null);
    const succeeded: VaultShareSummary[] = [];
    const failed: VaultShareSummary[] = [];
    for (const share of targets) {
      try {
        await authenticatorService.revokeShare(share.credential_id, share.user_id);
        succeeded.push(share);
      } catch {
        failed.push(share);
      }
    }
    if (succeeded.length > 0) {
      const revoked = new Set(succeeded.map((share) => `${share.credential_id}:${share.user_id}`));
      setShares((current) => current.filter((share) => !revoked.has(`${share.credential_id}:${share.user_id}`)));
      await onChanged('revoked', [...new Set(succeeded.map((share) => share.credential_id))]);
    }
    setProcessing(false);
    if (failed.length > 0) {
      setError(`${succeeded.length} acesso(s) revogado(s), mas ${failed.length} falharam. Tente novamente.`);
    } else {
      notify(`${succeeded.length} acesso(s) revogado(s). Nenhuma chave foi excluída.`);
    }
  };

  if (creating) {
    return (
      <AuthenticatorCreateCredentialModal
        onBack={() => setCreating(false)}
        onClose={onClose}
        onCreated={async (credentialIds) => {
          await onChanged('created', credentialIds);
          notify('Chave adicionada ao seu cofre.');
        }}
      />
    );
  }

  if (openedCredential) {
    return (
      <>
        <AuthenticatorCredentialAccessModal
          credential={openedCredential}
          canManage={canManage && openedCredential.can_manage}
          canDelete={canDelete && openedCredential.is_owner}
          onBack={() => setOpenedCredential(null)}
          onClose={onClose}
          onChanged={(change) => onChanged(change, [openedCredential.id])}
          onNotify={notify}
        />
        {notice && <Notice notice={notice} />}
      </>
    );
  }

  return (
    <div
      className={`fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-black/45 p-4`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Gerenciar chaves do Authenticator"
    >
      <div className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={bulkSharing ? () => { setBulkSharing(false); setError(null); } : onClose}
            className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100"
            aria-label={bulkSharing ? 'Voltar para a lista de chaves' : 'Voltar aos códigos'}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-900">{bulkSharing ? `Compartilhar ${selectedCredentials.length} chaves` : 'Gerenciar chaves'}</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">
              {bulkSharing ? 'Escolha quem receberá as chaves selecionadas.' : 'Adicione chaves, compartilhe e controle os acessos concedidos.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="bg-transparent text-slate-400 hover:text-slate-700" aria-label="Fechar gerenciamento">
            <X size={18} />
          </button>
        </div>

        {bulkSharing ? (
          <div className="overflow-y-auto p-5">
            <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5 text-[11.5px] text-amber-900">
              <strong>{selectedCredentials.length} chave(s)</strong> serão compartilhadas com a mesma pessoa.
            </div>
            <label className="mt-4 block text-[11.5px] font-semibold text-slate-600">Usuário do CRM</label>
            <div className="relative mt-1.5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus value={userQuery} onChange={(event) => setUserQuery(event.target.value)}
                placeholder="Digite nome ou e-mail"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-[13px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </div>
            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-100">
              {searching ? <div className="py-8 text-center text-slate-400"><Loader2 size={16} className="inline animate-spin" /></div>
                : userQuery.trim().length < 2 ? <p className="py-7 text-center text-[12px] text-slate-400">Digite pelo menos duas letras.</p>
                  : users.length === 0 ? <p className="py-7 text-center text-[12px] text-slate-400">Nenhum usuário disponível encontrado.</p>
                    : users.map((user) => (
                      <button
                        type="button" key={user.user_id} onClick={() => setSelectedUser(user)}
                        className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 ${selectedUser?.user_id === user.user_id ? 'bg-amber-50' : 'bg-white hover:bg-slate-50'}`}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{initials(user.name)}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{user.name}</span><span className="block truncate text-[11px] text-slate-500">{user.email}</span></span>
                        {selectedUser?.user_id === user.user_id && <Check size={15} className="text-amber-600" />}
                      </button>
                    ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {([['USE', 'Usar código', 'Somente visualizar e copiar.'], ['MANAGE', 'Gerenciar', 'Usar, compartilhar e revogar.']] as const).map(([value, label, description]) => (
                <button type="button" key={value} onClick={() => setLevel(value)} className={`rounded-xl border p-3 text-left ${level === value ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                  <span className="block text-[12.5px] font-semibold text-slate-800">{label}</span><span className="mt-0.5 block text-[10.5px] text-slate-500">{description}</span>
                </button>
              ))}
            </div>
            {error && <p className="mt-3 flex gap-1.5 text-[11.5px] text-red-600"><AlertTriangle size={13} className="mt-0.5 flex-none" />{error}</p>}
            <button type="button" disabled={!selectedUser || processing} onClick={() => void shareSelected()} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-amber-700 disabled:opacity-45">
              {processing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Compartilhar {selectedCredentials.length} chave(s)
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-100 px-5 pt-3">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Áreas do gerenciamento">
                <button type="button" role="tab" aria-selected={activeTab === 'mine'} onClick={() => { setActiveTab('mine'); setQuery(''); setError(null); }} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${activeTab === 'mine' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  {/* O contador é tudo o que a pessoa TEM, próprio e recebido.
                      Contar só as próprias mostrava "0" a quem usa treze. */}
                  <KeyRound size={13} /> Minhas chaves <span className="text-[10px] font-normal text-slate-400">{credentials.length}</span>
                </button>
                {canManage && (
                  <button type="button" role="tab" aria-selected={activeTab === 'shared'} onClick={() => { setActiveTab('shared'); setSelectedIds(new Set()); setQuery(''); setError(null); }} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors ${activeTab === 'shared' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Users size={13} /> Chaves compartilhadas {sharesLoaded && <span className="text-[10px] font-normal text-slate-400">{sharedCredentialCount}</span>}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 py-3">
                <div className="relative min-w-0 flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={activeTab === 'mine' ? 'Buscar nas minhas chaves' : 'Buscar chave ou usuário'} className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 pl-9 pr-3 text-[13px] outline-none focus:border-amber-400 focus:bg-white" />
                </div>
                {activeTab === 'mine' && canCreate && (
                  <button type="button" onClick={() => setCreating(true)} className="flex flex-none items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2.5 text-[12px] font-semibold text-white hover:bg-amber-700"><Plus size={14} /> Adicionar</button>
                )}
                {activeTab === 'shared' && (
                  <button type="button" onClick={() => { tentouCarregarShares.current = false; void loadShares(); }} disabled={sharesLoading} className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50" title="Atualizar compartilhamentos" aria-label="Atualizar compartilhamentos"><RefreshCw size={14} className={sharesLoading ? 'animate-spin' : ''} /></button>
                )}
              </div>
              {/* A seleção em lote só serve às chaves PRÓPRIAS. Para quem só
                  tem recebidas ela aparecia como "Selecionar todas · 0
                  selecionada(s)" sobre uma lista onde nada é selecionável. */}
              {activeTab === 'mine' && visible.length > 0 && (
                <div className="flex items-center justify-between gap-3 pb-3">
                  <label className="flex cursor-pointer items-center gap-2 text-[11.5px] font-medium text-slate-600">
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} className="h-4 w-4 rounded border-slate-300 accent-amber-600" />
                    Selecionar {query ? 'resultados' : 'todas'}
                  </label>
                  <span className="text-[11px] text-slate-400">{selectedIds.size} selecionada(s)</span>
                </div>
              )}
            </div>

            {activeTab === 'mine' ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  {/* O vazio só é vazio quando não há NADA — nem própria, nem
                      recebida. Antes ele olhava só para as próprias e dizia
                      "você ainda não adicionou uma chave" a quem tinha treze. */}
                  {visible.length === 0 && recebidas.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                      <KeyRound size={22} className="mx-auto text-slate-300" />
                      <p className="mt-2 text-[12.5px] font-medium text-slate-500">{query ? 'Nenhuma chave encontrada.' : 'Você ainda não tem nenhuma chave.'}</p>
                      {!query && canCreate && <button type="button" onClick={() => setCreating(true)} className="mt-3 text-[12px] font-semibold text-amber-700 hover:text-amber-800">Adicionar minha primeira chave</button>}
                    </div>
                  ) : (<>
                  {/* Título só quando há os DOIS grupos. Sozinho, ele repetiria
                      o nome da aba logo acima — e um título que não separa nada
                      de nada é ruído. */}
                  {visible.length > 0 && recebidas.length > 0 && (
                    <div className="mb-1 flex items-center gap-2 px-2">
                      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                        Suas chaves
                      </span>
                      <span className="h-px flex-1 bg-slate-100" />
                      <span className="text-[10.5px] text-slate-400">{visible.length}</span>
                    </div>
                  )}
                  {visible.map((credential) => {
                    const checked = selectedIds.has(credential.id);
                    return (
                      <div key={credential.id} className={`flex items-center gap-2 rounded-xl px-2 py-1 transition-colors ${checked ? 'bg-amber-50/80' : 'hover:bg-slate-50'}`}>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-1 py-2">
                          <input type="checkbox" checked={checked} onChange={() => toggleOne(credential.id)} className="h-4 w-4 flex-none rounded border-slate-300 accent-amber-600" />
                          <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${checked ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{credential.shared_count > 0 ? <Users size={16} /> : <KeyRound size={16} />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-slate-800">{credential.name}</span>
                            <span className="mt-0.5 block truncate text-[10.5px] text-slate-500">Chave própria{credential.shared_count > 0 && ` · compartilhada com ${credential.shared_count} pessoa(s)`}</span>
                          </span>
                        </label>
                        <button type="button" onClick={() => setOpenedCredential(credential)} className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-transparent text-slate-400 hover:bg-white hover:text-amber-700" title="Abrir detalhes" aria-label={`Abrir detalhes de ${credential.name}`}><ChevronRight size={16} /></button>
                      </div>
                    );
                  })}
                  </>)}

                  {recebidas.length > 0 && (
                    <>
                      <div className="mb-1 mt-4 flex items-center gap-2 px-2 first:mt-0">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">
                          Compartilhadas com você
                        </span>
                        <span className="h-px flex-1 bg-slate-100" />
                        <span className="text-[10.5px] text-slate-400">{recebidas.length}</span>
                      </div>
                      {recebidas.map((credential) => (
                        <div key={credential.id} className="flex items-center gap-2 rounded-xl px-2 py-1 transition-colors hover:bg-slate-50">
                          {/* Sem caixa de seleção: as ações em lote são
                              compartilhar e excluir, e nenhuma vale para a
                              chave de outra pessoa. O recuo alinha com as de
                              cima, para as duas listas lerem como uma só. */}
                          <span className="ml-[25px] flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-500"><KeyRound size={16} /></span>
                          <span className="min-w-0 flex-1 py-2">
                            <span className="block truncate text-[13px] font-semibold text-slate-800">{credential.name}</span>
                            <span className="mt-0.5 block truncate text-[10.5px] text-slate-500">
                              De {credential.owner_name ?? 'outro usuário'}
                              {credential.role === 'USE' ? ' · você pode usar'
                                : credential.role === 'MANAGE' ? ' · você pode usar e compartilhar'
                                : credential.role === 'EXPORT' ? ' · você pode usar, compartilhar e exportar'
                                : ''}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={processing}
                            onClick={() => void sairDaChave(credential)}
                            className="flex flex-none items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10.5px] font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-45"
                            title={`Sair de ${credential.name}`}
                          >
                            <UserMinus size={12} /> Sair
                          </button>
                          <button type="button" onClick={() => setOpenedCredential(credential)} className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-transparent text-slate-400 hover:bg-white hover:text-amber-700" title="Abrir detalhes" aria-label={`Abrir detalhes de ${credential.name}`}><ChevronRight size={16} /></button>
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-3">
                  {error && <p className="mb-2 flex gap-1.5 text-[11.5px] text-red-600"><AlertTriangle size={13} className="mt-0.5 flex-none" />{error}</p>}
                  {selectedCredentials.length === 0 ? (
                    <p className="text-center text-[11.5px] text-slate-400">
                      {/* Pedir para selecionar o que não existe é mandar a pessoa
                          procurar um botão que não está lá. */}
                      {visible.length === 0
                        ? 'Estas chaves são de outras pessoas. Você pode usá-las ou sair delas.'
                        : 'Selecione uma ou mais chaves para compartilhar ou excluir.'}
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      {selectedCredentials.length === 1 && <button type="button" onClick={() => setOpenedCredential(selectedCredentials[0])} className="mr-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-50">Detalhes</button>}
                      <div className="flex-1" />
                      <button type="button" disabled={!canShareSelection || processing} onClick={() => { setBulkSharing(true); setError(null); }} className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"><Share2 size={13} /> Compartilhar</button>
                      <button type="button" disabled={!canDeleteSelection || processing} onClick={() => void deleteSelected()} className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40" title="Excluir selecionadas para todos">{processing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Excluir</button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 p-3">
                  {sharesLoading && !sharesLoaded ? <div className="flex items-center justify-center gap-2 py-12 text-[12px] text-slate-400"><Loader2 size={16} className="animate-spin" /> Carregando acessos…</div>
                    /* Falhou: diz o que houve e oferece a saída. Cair no vazio
                       de "nenhuma chave está compartilhada" seria pior que o
                       spinner eterno — o spinner ao menos não afirma nada. */
                    : (error && !sharesLoaded) ? (
                      <div className="px-4 py-12 text-center">
                        <AlertTriangle size={23} className="mx-auto text-amber-400" />
                        <p className="mt-2 text-[12.5px] font-medium text-slate-600">Não foi possível carregar os acessos.</p>
                        <p className="mt-1 text-[11px] text-slate-400">{error}</p>
                        <button
                          type="button"
                          onClick={() => { tentouCarregarShares.current = false; void loadShares(); }}
                          disabled={sharesLoading}
                          className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Tentar de novo
                        </button>
                      </div>
                    ) : sharedGroups.length === 0 ? (
                      <div className="px-4 py-12 text-center"><Users size={23} className="mx-auto text-slate-300" /><p className="mt-2 text-[12.5px] font-medium text-slate-500">{query ? 'Nenhum compartilhamento encontrado.' : 'Nenhuma chave está compartilhada.'}</p><p className="mt-1 text-[11px] text-slate-400">Quando você compartilhar uma chave, os acessos aparecerão aqui.</p></div>
                    ) : sharedGroups.map(([credentialId, group]) => (
                      <section key={credentialId} className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-white last:mb-0">
                        <div className="flex items-center gap-3 border-b border-slate-100 px-3 py-3">
                          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-700"><KeyRound size={16} /></span>
                          <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-slate-800">{group.name}</span><span className="mt-0.5 block truncate text-[10.5px] text-slate-500">{group.issuer || 'Sem emissor'} · {group.shares.length} acesso(s){group.credential && !group.credential.is_owner ? ` · de ${group.ownerName ?? 'outro usuário'}` : ''}</span></span>
                          <button type="button" disabled={processing} onClick={() => void revokeShares(group.shares, 'key')} className="flex flex-none items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-2.5 py-1.5 text-[10.5px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-45"><UserMinus size={12} /> Revogar todos</button>
                        </div>
                        <div>
                          {group.shares.map((share) => (
                            <div key={`${share.credential_id}:${share.user_id}`} className="flex items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 last:border-0">
                              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{initials(share.name ?? share.email ?? '?')}</span>
                              <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium text-slate-700">{share.name ?? 'Usuário sem nome'}{!share.is_active && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">inativo</span>}</span><span className="block truncate text-[10.5px] text-slate-400">{share.email ?? 'Sem e-mail'} · {share.permission === 'USE' ? 'usar código' : share.permission === 'MANAGE' ? 'gerenciar' : 'exportar'}</span></span>
                              <button type="button" disabled={processing} onClick={() => void revokeShares([share], 'one')} className="rounded-lg px-2.5 py-1.5 text-[10.5px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-45">Revogar</button>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-3">
                  <span className="text-[11px] text-slate-400">Revogar remove apenas o acesso; a chave continua no cofre.</span>
                  {shares.length > 0 && <button type="button" disabled={processing} onClick={() => void revokeShares(shares, 'all')} className="flex flex-none items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-45">{processing ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />} Revogar tudo</button>}
                </div>
                {error && <p className="border-t border-red-100 bg-red-50 px-5 py-2.5 text-[11.5px] text-red-600">{error}</p>}
              </>
            )}
          </>
        )}
      </div>
      {notice && <Notice notice={notice} />}
    </div>
  );
};

const Notice: React.FC<{ notice: { message: string; type: 'ok' | 'error' } }> = ({ notice }) => (
  <div className={`fixed bottom-6 right-6 ${zc.NOTICE} flex items-center gap-2 rounded-xl px-4 py-3 text-[12.5px] font-medium text-white shadow-lg ${notice.type === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}>
    {notice.type === 'ok' ? <Check size={14} /> : <AlertTriangle size={14} />} {notice.message}
  </div>
);

export default AuthenticatorCredentialsManagerModal;
