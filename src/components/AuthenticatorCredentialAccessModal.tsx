import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, KeyRound, Loader2, Search, Share2, Trash2, UserMinus, X,
} from 'lucide-react';
import {
  authenticatorService,
  type VaultPermission,
} from '../services/authenticator.service';
import { zc } from '../styles/layers';

type CredentialForAccess = {
  id: string;
  name: string;
  issuer: string | null;
  owner_user_id: string;
  owner_name: string | null;
};

type PermissionEntry = {
  user_id: string;
  name: string | null;
  email: string | null;
  is_active: boolean;
  permission: VaultPermission;
  created_at: string;
};

type UserResult = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  avatar_url: string | null;
};

const LEVEL_LABELS: Record<VaultPermission, string> = {
  USE: 'Usar código',
  MANAGE: 'Gerenciar',
  EXPORT: 'Exportar segredo',
};

function initials(name: string | null | undefined): string {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
}

export const AuthenticatorCredentialAccessModal: React.FC<{
  credential: CredentialForAccess;
  canManage: boolean;
  canDelete: boolean;
  onBack?: () => void;
  onClose: () => void;
  onChanged: (change: 'shared' | 'revoked' | 'deleted') => void | Promise<void>;
  onNotify?: (message: string, type?: 'ok' | 'error') => void;
}> = ({ credential, canManage, canDelete, onBack, onClose, onChanged, onNotify }) => {
  const [owner, setOwner] = useState<{ user_id: string; name: string | null; email: string | null } | null>(null);
  const [permissions, setPermissions] = useState<PermissionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<UserResult | null>(null);
  const [level, setLevel] = useState<Extract<VaultPermission, 'USE' | 'MANAGE'>>('USE');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const notify = (message: string, type: 'ok' | 'error' = 'ok') => {
    if (onNotify) onNotify(message, type);
    else if (type === 'error') setError(message);
  };

  const loadPermissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await authenticatorService.permissions(credential.id);
      setOwner(data.owner);
      setPermissions(data.permissions);
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível carregar os acessos desta chave.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPermissions(); }, [credential.id]);

  useEffect(() => {
    if (!sharing) return;
    const term = query.trim();
    setSelected(null);
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      authenticatorService.searchUsers(term)
        .then(({ users }) => {
          if (cancelled) return;
          const alreadyShared = new Set(permissions.map((permission) => permission.user_id));
          setResults(users.filter((user) => user.user_id !== credential.owner_user_id && !alreadyShared.has(user.user_id)));
        })
        .catch((cause: any) => {
          if (!cancelled) setError(cause?.message ?? 'Não foi possível buscar usuários.');
        })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [credential.owner_user_id, permissions, query, sharing]);

  const activePermissions = useMemo(
    () => permissions.filter((permission) => permission.is_active),
    [permissions],
  );

  const share = async () => {
    if (!selected || !canManage) return;
    setSaving(true);
    setError(null);
    try {
      await authenticatorService.share(credential.id, selected.user_id, level);
      await loadPermissions();
      await onChanged('shared');
      notify(`Chave compartilhada com ${selected.name}.`);
      setSharing(false);
      setQuery('');
      setResults([]);
      setSelected(null);
      setLevel('USE');
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível compartilhar a chave.');
    } finally {
      setSaving(false);
    }
  };

  const revoke = async (permission: PermissionEntry) => {
    if (!canManage) return;
    const name = permission.name ?? permission.email ?? 'este usuário';
    if (!window.confirm(`Revogar o acesso de ${name} a “${credential.name}”?\n\nSomente essa pessoa perderá o acesso. A chave continuará disponível para você e para os demais usuários.`)) return;

    setRevoking(permission.user_id);
    setError(null);
    try {
      await authenticatorService.revokeShare(credential.id, permission.user_id);
      setPermissions((current) => current.filter((item) => item.user_id !== permission.user_id));
      await onChanged('revoked');
      notify(`Acesso de ${name} revogado.`);
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível revogar o compartilhamento.');
    } finally {
      setRevoking(null);
    }
  };

  const remove = async () => {
    if (!canDelete) return;
    if (!window.confirm(`Excluir definitivamente “${credential.name}” do cofre?\n\nA chave deixará de gerar códigos e sumirá para TODAS as pessoas com quem foi compartilhada. Esta ação não é o mesmo que revogar um usuário.`)) return;

    setDeleting(true);
    setError(null);
    try {
      await authenticatorService.remove(credential.id, 'Excluída pelo proprietário no CRM.');
      await onChanged('deleted');
      notify('Chave excluída para todos os usuários.');
      onClose();
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível excluir a chave.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-black/45 p-4`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Gerenciar acessos de ${credential.name}`}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          {sharing || onBack ? (
            <button
              type="button"
              onClick={() => {
                if (sharing) { setSharing(false); setError(null); }
                else onBack?.();
              }}
              className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100"
              aria-label={sharing ? 'Voltar para a chave' : 'Voltar para a lista de chaves'}
            >
              <ArrowLeft size={16} />
            </button>
          ) : (
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <KeyRound size={17} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold text-slate-900">
              {sharing ? 'Compartilhar chave' : credential.name}
            </h2>
            <p className="mt-0.5 truncate text-[11.5px] text-slate-500">
              {sharing ? credential.name : (credential.issuer ?? 'Gerenciar compartilhamentos')}
            </p>
          </div>
          <button type="button" onClick={onClose} className="bg-transparent text-slate-400 hover:text-slate-700" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        {sharing ? (
          <div className="p-5">
            <label className="block text-[11.5px] font-semibold text-slate-600">Usuário do CRM</label>
            <div className="relative mt-1.5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Digite nome ou e-mail"
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-[13px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </div>

            <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-100">
              {searching ? (
                <div className="py-8 text-center text-slate-400"><Loader2 size={16} className="inline animate-spin" /></div>
              ) : query.trim().length < 2 ? (
                <p className="px-3 py-7 text-center text-[12px] text-slate-400">Digite pelo menos duas letras.</p>
              ) : results.length === 0 ? (
                <p className="px-3 py-7 text-center text-[12px] text-slate-400">Nenhum usuário disponível encontrado.</p>
              ) : results.map((user) => {
                const isSelected = selected?.user_id === user.user_id;
                return (
                  <button
                    type="button"
                    key={user.user_id}
                    onClick={() => setSelected(user)}
                    className={`flex w-full items-center gap-2.5 border-b border-slate-100 px-3 py-2.5 text-left last:border-0 ${isSelected ? 'bg-amber-50' : 'bg-white hover:bg-slate-50'}`}
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-500">{initials(user.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-slate-800">{user.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{user.email}</span>
                    </span>
                    {isSelected && <Check size={15} className="text-amber-600" />}
                  </button>
                );
              })}
            </div>

            <fieldset className="mt-4">
              <legend className="text-[11.5px] font-semibold text-slate-600">O que essa pessoa poderá fazer?</legend>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {([
                  ['USE', 'Usar código', 'Somente visualizar e copiar.'],
                  ['MANAGE', 'Gerenciar', 'Usar, compartilhar e revogar.'],
                ] as const).map(([value, label, description]) => (
                  <label key={value} className={`cursor-pointer rounded-xl border p-3 ${level === value ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}>
                    <input type="radio" name="vault-level" value={value} checked={level === value} onChange={() => setLevel(value)} className="sr-only" />
                    <span className="block text-[12.5px] font-semibold text-slate-800">{label}</span>
                    <span className="mt-0.5 block text-[10.5px] leading-relaxed text-slate-500">{description}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-red-600"><AlertTriangle size={13} className="mt-0.5 flex-none" />{error}</p>}

            <button
              type="button"
              disabled={!selected || saving}
              onClick={() => void share()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
              Compartilhar
            </button>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-5">
            <div>
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Proprietário</p>
              <div className="mt-2 flex items-center gap-2.5">
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-amber-50 text-[10px] font-bold text-amber-700">{initials(owner?.name ?? credential.owner_name)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-slate-800">{owner?.name ?? credential.owner_name ?? 'Proprietário'}</span>
                  {owner?.email && <span className="block truncate text-[11px] text-slate-500">{owner.email}</span>}
                </span>
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9.5px] font-bold text-amber-700">DONO</span>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Compartilhada com</p>
                {canManage && (
                  <button type="button" onClick={() => { setSharing(true); setError(null); }} className="flex items-center gap-1 bg-transparent text-[11.5px] font-semibold text-amber-700 hover:text-amber-800">
                    <Share2 size={12} /> Compartilhar
                  </button>
                )}
              </div>

              {loading ? (
                <div className="py-8 text-center text-slate-400"><Loader2 size={16} className="inline animate-spin" /></div>
              ) : activePermissions.length === 0 ? (
                <p className="mt-2 rounded-xl bg-slate-50 px-3 py-5 text-center text-[12px] text-slate-400">Ninguém além do proprietário.</p>
              ) : (
                <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {activePermissions.map((permission) => (
                    <div key={permission.user_id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-slate-100 text-[9.5px] font-bold text-slate-500">{initials(permission.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-slate-800">{permission.name ?? permission.email ?? 'Usuário'}</span>
                        <span className="block text-[10.5px] text-slate-500">{LEVEL_LABELS[permission.permission]}</span>
                      </span>
                      {canManage && (
                        <button
                          type="button"
                          disabled={revoking === permission.user_id}
                          onClick={() => void revoke(permission)}
                          className="flex items-center gap-1 bg-transparent text-[10.5px] font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                          title="Revogar somente para esta pessoa"
                        >
                          {revoking === permission.user_id ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                          Revogar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-red-600"><AlertTriangle size={13} className="mt-0.5 flex-none" />{error}</p>}

            {canDelete && (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void remove()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Excluir chave para todos
                </button>
                <p className="mt-1.5 text-center text-[10.5px] leading-relaxed text-slate-400">
                  Diferente de revogar: a chave inteira deixa de funcionar para todas as pessoas.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthenticatorCredentialAccessModal;
