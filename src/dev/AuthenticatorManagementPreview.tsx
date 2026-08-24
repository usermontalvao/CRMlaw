import React, { useState } from 'react';
import AuthenticatorCredentialsManagerModal from '../components/AuthenticatorCredentialsManagerModal';
import type { VaultCredentialSummary, VaultShareSummary } from '../services/authenticator.service';

const CREDENTIALS: VaultCredentialSummary[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Google Workspace',
    issuer: 'Google',
    account_label: 'administracao@escritorio.com.br',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    status: 'active',
    owner_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_name: 'Pedro Montalvão',
    is_owner: true,
    role: 'OWNER',
    shared: true,
    shared_count: 2,
    favorite: true,
    can_export: true,
    can_manage: true,
    created_at: new Date().toISOString(),
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Portal do Tribunal',
    issuer: 'PJe',
    account_label: 'Escritório',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    status: 'active',
    owner_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    owner_name: 'Pedro Montalvão',
    is_owner: true,
    role: 'OWNER',
    shared: false,
    shared_count: 0,
    favorite: false,
    can_export: true,
    can_manage: true,
    created_at: new Date().toISOString(),
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'e-CAC do escritório',
    issuer: 'Receita Federal',
    account_label: 'Compartilhada',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    status: 'active',
    owner_user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    owner_name: 'Maria Silva',
    is_owner: false,
    role: 'MANAGE',
    shared: true,
    shared_count: 3,
    favorite: false,
    can_export: false,
    can_manage: true,
    created_at: new Date().toISOString(),
  },
];

const SHARES: VaultShareSummary[] = [
  {
    credential_id: CREDENTIALS[0].id,
    credential_name: CREDENTIALS[0].name,
    credential_issuer: CREDENTIALS[0].issuer,
    owner_user_id: CREDENTIALS[0].owner_user_id,
    owner_name: CREDENTIALS[0].owner_name,
    user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    name: 'Ana Carolina',
    email: 'ana@escritorio.com.br',
    is_active: true,
    permission: 'USE',
    created_at: new Date().toISOString(),
  },
  {
    credential_id: CREDENTIALS[0].id,
    credential_name: CREDENTIALS[0].name,
    credential_issuer: CREDENTIALS[0].issuer,
    owner_user_id: CREDENTIALS[0].owner_user_id,
    owner_name: CREDENTIALS[0].owner_name,
    user_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    name: 'Carlos Souza',
    email: 'carlos@escritorio.com.br',
    is_active: true,
    permission: 'MANAGE',
    created_at: new Date().toISOString(),
  },
];

const AuthenticatorManagementPreview: React.FC = () => {
  const [open, setOpen] = useState(true);
  return (
    <main className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-slate-900">Meus códigos</span>
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg bg-amber-50 px-2 py-1 text-[10.5px] font-semibold text-amber-700">Gerenciar</button>
        </div>
      </div>
      {open && (
        <AuthenticatorCredentialsManagerModal
          credentials={CREDENTIALS}
          canCreate
          canManage
          canDelete
          sharesLoader={async () => ({ shares: SHARES })}
          onClose={() => setOpen(false)}
          onChanged={() => {}}
        />
      )}
    </main>
  );
};

export default AuthenticatorManagementPreview;
