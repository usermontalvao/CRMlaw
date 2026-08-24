import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, KeyRound, Loader2, Plus, ShieldCheck, X } from 'lucide-react';
import { authenticatorService } from '../services/authenticator.service';
import { zc } from '../styles/layers';

const AuthenticatorCreateCredentialModal: React.FC<{
  onBack: () => void;
  onClose: () => void;
  onCreated: (credentialIds: string[]) => void | Promise<void>;
}> = ({ onBack, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const cleanName = name.trim();
    const payload = secret.trim();
    if (!payload) {
      setError('Cole a chave secreta ou o endereço otpauth://.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (/^otpauth:\/\//i.test(payload)) {
        const analysis = await authenticatorService.analyzeImport(payload);
        if (analysis.items.length !== 1) {
          throw new Error(analysis.skipped[0]?.reason ?? 'Não foi possível identificar uma única chave nesse endereço.');
        }
        const item = analysis.items[0];
        if (item.duplicate) throw new Error(`Esta chave já existe como “${item.duplicate.name}”.`);
        const result = await authenticatorService.commitImport(payload, [item.index]);
        const created = result.created[0];
        if (!created) throw new Error(result.skipped[0]?.reason ?? 'A chave não pôde ser adicionada.');
        if (cleanName && cleanName !== created.name) {
          await authenticatorService.update(created.id, { name: cleanName });
        }
        await onCreated([created.id]);
      } else {
        if (!cleanName) {
          setError('Informe um nome para identificar a chave.');
          return;
        }
        const result = await authenticatorService.create({
          name: cleanName,
          issuer: issuer.trim() || null,
          account_label: accountLabel.trim() || null,
          secret: payload.replace(/\s+/g, '').toUpperCase(),
        });
        await onCreated([result.credential.id]);
      }
      setSecret('');
      onBack();
    } catch (cause: any) {
      setError(cause?.message ?? 'Não foi possível adicionar a chave.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${zc.MODAL} flex items-center justify-center bg-black/45 p-4`} role="dialog" aria-modal="true" aria-label="Adicionar chave">
      <div className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <button type="button" onClick={onBack} className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100" aria-label="Voltar para minhas chaves">
            <ArrowLeft size={16} />
          </button>
          <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-amber-50 text-amber-700"><KeyRound size={16} /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-900">Adicionar chave</h2>
            <p className="mt-0.5 text-[11.5px] text-slate-500">Cadastre uma chave pessoal usando o segredo ou um endereço otpauth://.</p>
          </div>
          <button type="button" onClick={onClose} className="bg-transparent text-slate-400 hover:text-slate-700" aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5">
          <label className="block text-[11.5px] font-semibold text-slate-600">Nome da chave</label>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Google Workspace" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-[11.5px] font-semibold text-slate-600">Emissor <span className="font-normal text-slate-400">(opcional)</span>
              <input value={issuer} onChange={(event) => setIssuer(event.target.value)} placeholder="Google, PJe…" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-normal outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
            </label>
            <label className="block text-[11.5px] font-semibold text-slate-600">Conta <span className="font-normal text-slate-400">(opcional)</span>
              <input value={accountLabel} onChange={(event) => setAccountLabel(event.target.value)} placeholder="usuario@empresa.com" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] font-normal outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
            </label>
          </div>

          <label className="mt-4 block text-[11.5px] font-semibold text-slate-600">Chave secreta ou endereço otpauth://</label>
          <textarea value={secret} onChange={(event) => setSecret(event.target.value)} rows={4} spellCheck={false} placeholder="Cole aqui o segredo Base32 ou otpauth://…" className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-[12px] outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />

          <div className="mt-3 flex gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-[11px] leading-relaxed text-emerald-800">
            <ShieldCheck size={15} className="mt-0.5 flex-none" />
            <span>A chave será criptografada no cofre. O segredo não fica salvo nesta tela nem será exibido novamente.</span>
          </div>
          {error && <p className="mt-3 flex gap-1.5 text-[11.5px] text-red-600"><AlertTriangle size={13} className="mt-0.5 flex-none" />{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onBack} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancelar</button>
            <button type="button" onClick={() => void save()} disabled={saving || !secret.trim()} className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-amber-700 disabled:opacity-45">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Adicionar chave
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthenticatorCreateCredentialModal;
