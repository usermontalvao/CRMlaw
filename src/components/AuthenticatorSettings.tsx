import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Shield, Search, Loader2, RefreshCw, KeyRound, Users, History, Lock,
  AlertTriangle, X, Check, Trash2, Eye, Copy, ChevronRight, ShieldAlert, Puzzle,
  Monitor, UserCog,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  authenticatorService, AUDIT_LABELS, AUDIT_CRITICAL,
  type VaultAdminCredential, type VaultAdminSession, type VaultAuditEvent, type VaultSecurityMeta,
  type VaultPermission,
} from '../services/authenticator.service';
import { zc } from '../styles/layers';

/**
 * Configurações → Authenticator.
 *
 * O que esta tela É: o inventário do cofre — de quem é cada chave, com quem
 * está compartilhada, quem usou o quê, e o botão de emergência.
 *
 * O que ela NÃO É: uma janela para os segredos. Administrador abrindo esta
 * página não recebe segredo nenhum; a lista traz só metadado. Recuperar uma
 * chave é operação break-glass, com motivo escrito, PIN e reautenticação — e
 * cada etapa vira uma linha de auditoria que ninguém apaga.
 *
 * Nada aqui decide permissão: os botões que a tela esconde o backend recusa de
 * novo, com 403, se alguém chamar a API na mão.
 */

type Aba = 'credenciais' | 'usuarios' | 'compartilhamentos' | 'sessoes' | 'auditoria' | 'seguranca';

const ABAS: { chave: Aba; rotulo: string; icone: React.ComponentType<any> }[] = [
  { chave: 'credenciais',        rotulo: 'Credenciais',       icone: KeyRound },
  { chave: 'usuarios',           rotulo: 'Usuários',          icone: Users },
  { chave: 'compartilhamentos',  rotulo: 'Compartilhamentos', icone: Shield },
  { chave: 'sessoes',            rotulo: 'Sessões',           icone: Monitor },
  { chave: 'auditoria',          rotulo: 'Auditoria',         icone: History },
  { chave: 'seguranca',          rotulo: 'Segurança',         icone: Lock },
];

const NIVEL_CLS: Record<string, string> = {
  OWNER:  'bg-amber-100 text-amber-700 border-amber-200',
  EXPORT: 'bg-red-100 text-red-600 border-red-200',
  MANAGE: 'bg-blue-100 text-blue-700 border-blue-200',
  USE:    'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function quando(iso: string): string {
  const data = new Date(iso);
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function iniciais(nome: string | null): string {
  return String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

// ════════════════════════════════════════════════════════════════════════════

export const AuthenticatorSettings: React.FC = () => {
  const [aba, setAba] = useState<Aba>('credenciais');
  const [credenciais, setCredenciais] = useState<VaultAdminCredential[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [incluirExcluidas, setIncluirExcluidas] = useState(false);
  const [versaoAtiva, setVersaoAtiva] = useState<number | null>(null);
  const [selecionada, setSelecionada] = useState<VaultAdminCredential | null>(null);
  const [recuperar, setRecuperar] = useState<VaultAdminCredential | null>(null);
  const [transferir, setTransferir] = useState<VaultAdminCredential | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);
  // Conforto, não autorização: a régua de verdade é o 403 do cofre. Sem isto,
  // quem não é administrador veria a tela inteira pintada de mensagens de erro.
  const [ehAdmin, setEhAdmin] = useState<boolean | null>(null);

  const notificar = useCallback((texto: string, tipo: 'ok' | 'erro' = 'ok') => {
    setAviso({ texto, tipo });
    window.setTimeout(() => setAviso(null), 3600);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { credentials, active_key_version } = await authenticatorService.adminCredentials({ includeDeleted: incluirExcluidas });
      setCredenciais(credentials);
      setVersaoAtiva(active_key_version);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível carregar o cofre.');
    } finally {
      setCarregando(false);
    }
  }, [incluirExcluidas]);

  useEffect(() => {
    authenticatorService.me()
      .then((perfil) => setEhAdmin(perfil.user.is_admin))
      .catch(() => setEhAdmin(false));
  }, []);

  useEffect(() => { if (ehAdmin) void carregar(); }, [carregar, ehAdmin]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!termo) return credenciais;
    return credenciais.filter((c) => {
      const alvo = `${c.name} ${c.issuer ?? ''} ${c.owner_name ?? ''} ${c.owner_email ?? ''}`
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return alvo.includes(termo);
    });
  }, [credenciais, busca]);

  if (ehAdmin === null) {
    return <div className="settings-card py-12 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>;
  }

  if (!ehAdmin) {
    return (
      <div className="settings-card">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-none">
            <Lock size={17} className="text-gray-500" />
          </div>
          <div>
            <p className="settings-card-title" style={{ margin: 0 }}>Área restrita a administradores</p>
            <p className="text-[12.5px] text-gray-500 mt-1 max-w-xl leading-relaxed">
              O inventário do cofre e a recuperação de emergência são de administrador. As <strong>suas</strong>{' '}
              chaves ficam na extensão Jurius Authenticator, no Chrome — lá você cadastra, importa, compartilha e
              copia código sem passar por aqui.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── cabeçalho ───────────────────────────────────────────────────── */}
      <div className="settings-card">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3">
            <img
              src="/logo.png"
              alt="Jurius"
              className="w-9 h-9 rounded-xl flex-none object-cover"
              width={36}
              height={36}
            />
            <div>
              <p className="settings-card-title" style={{ margin: 0 }}>Authenticator</p>
              <p className="text-[12.5px] text-gray-500 mt-0.5 max-w-xl leading-relaxed">
                Cofre de códigos 2FA do escritório. Esta tela mostra <strong>de quem é</strong> cada chave e{' '}
                <strong>quem tem acesso</strong> — nunca o segredo. Liberar um segredo exige motivo, PIN e
                reautenticação, e fica registrado na auditoria.
              </p>
            </div>
          </div>
          <button className="settings-btn-ghost flex items-center gap-1.5 text-[11.5px] px-3 py-1" onClick={() => void carregar()} disabled={carregando}>
            {carregando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Atualizar
          </button>
        </div>

        <div className="flex items-center gap-1 mt-4 border-b border-gray-200 -mb-1 overflow-x-auto">
          {ABAS.map(({ chave, rotulo, icone: Icone }) => (
            <button
              key={chave}
              onClick={() => setAba(chave)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                aba === chave ? 'border-amber-500 text-amber-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icone size={13} />
              {rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="settings-card flex items-center gap-2 text-[13px] text-red-600">
          <AlertTriangle size={15} /> {erro}
        </div>
      )}

      {aba === 'credenciais' && (
        <AbaCredenciais
          credenciais={filtradas}
          carregando={carregando}
          busca={busca}
          onBusca={setBusca}
          incluirExcluidas={incluirExcluidas}
          onIncluirExcluidas={setIncluirExcluidas}
          onAbrir={setSelecionada}
        />
      )}

      {aba === 'usuarios' && <AbaUsuarios credenciais={credenciais} carregando={carregando} />}

      {aba === 'compartilhamentos' && (
        <AbaCompartilhamentos
          credenciais={credenciais}
          carregando={carregando}
          onRevogar={async (credencial, userId, nome) => {
            if (!window.confirm(`Remover o acesso de ${nome} a "${credencial.name}"?\n\nO efeito é imediato: o próximo pedido de código já é recusado.`)) return;
            try {
              await authenticatorService.revokeShare(credencial.id, userId);
              notificar('Acesso removido. O bloqueio vale a partir de agora.');
              void carregar();
            } catch (e: any) {
              notificar(e?.message ?? 'Não foi possível remover.', 'erro');
            }
          }}
        />
      )}

      {aba === 'sessoes' && <AbaSessoes onNotificar={notificar} />}

      {aba === 'auditoria' && <AbaAuditoria />}

      {aba === 'seguranca' && <AbaSeguranca versaoAtiva={versaoAtiva} onNotificar={notificar} />}

      {selecionada && (
        <PainelCredencial
          credencial={selecionada}
          onFechar={() => setSelecionada(null)}
          onRecuperar={(c) => { setSelecionada(null); setRecuperar(c); }}
          onTransferir={(c) => { setSelecionada(null); setTransferir(c); }}
          onMudou={() => void carregar()}
          onNotificar={notificar}
        />
      )}

      {transferir && (
        <ModalTransferencia
          credencial={transferir}
          onFechar={() => setTransferir(null)}
          onPronto={() => { setTransferir(null); void carregar(); }}
          onNotificar={notificar}
        />
      )}

      {recuperar && (
        <ModalRecuperacao
          credencial={recuperar}
          onFechar={() => setRecuperar(null)}
          onNotificar={notificar}
        />
      )}

      {aviso && (
        <div className={`fixed bottom-6 right-6 ${zc.NOTICE} flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-[13px] font-medium ${
          aviso.tipo === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {aviso.tipo === 'ok' ? <Check size={15} /> : <AlertTriangle size={15} />}
          {aviso.texto}
        </div>
      )}
    </div>
  );
};

// ── aba: credenciais ────────────────────────────────────────────────────────

const AbaCredenciais: React.FC<{
  credenciais: VaultAdminCredential[];
  carregando: boolean;
  busca: string;
  onBusca: (v: string) => void;
  incluirExcluidas: boolean;
  onIncluirExcluidas: (v: boolean) => void;
  onAbrir: (c: VaultAdminCredential) => void;
}> = ({ credenciais, carregando, busca, onBusca, incluirExcluidas, onIncluirExcluidas, onAbrir }) => (
  <div className="settings-card">
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <div className="relative flex-1 min-w-[220px]">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="settings-input pl-9"
          placeholder="Buscar por nome, emissor ou proprietário"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-1.5 text-[12px] text-gray-500 cursor-pointer">
        <input type="checkbox" checked={incluirExcluidas} onChange={(e) => onIncluirExcluidas(e.target.checked)} />
        Mostrar excluídas
      </label>
      <span className="text-[12px] text-gray-400">{credenciais.length} chave(s)</span>
    </div>

    {carregando ? (
      <div className="py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
    ) : credenciais.length === 0 ? (
      <div className="py-10 text-center text-gray-400 text-[13px]">Nenhuma chave no cofre ainda.</div>
    ) : (
      <div className="divide-y divide-gray-100">
        {credenciais.map((c) => (
          <button
            key={c.id}
            onClick={() => onAbrir(c)}
            className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-gray-50 px-1 rounded transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-none text-[11px] font-bold text-gray-500">
              {iniciais(c.issuer ?? c.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-medium truncate">{c.name}</span>
                {c.status === 'archived' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">arquivada</span>}
                {c.status === 'deleted' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">excluída</span>}
              </div>
              <div className="text-[11.5px] text-gray-500 truncate">
                Proprietário: {c.owner_name ?? c.owner_email ?? '—'}
                {c.shares.length > 0 && ` · Compartilhado: ${c.shares.map((s) => s.name ?? 'usuário').join(', ')}`}
              </div>
            </div>
            <span className="text-[11px] text-gray-400 whitespace-nowrap hidden sm:inline">{c.algorithm} · {c.digits}</span>
            <ChevronRight size={15} className="text-gray-300 flex-none" />
          </button>
        ))}
      </div>
    )}
  </div>
);

// ── aba: usuários ───────────────────────────────────────────────────────────

const AbaUsuarios: React.FC<{ credenciais: VaultAdminCredential[]; carregando: boolean }> = ({ credenciais, carregando }) => {
  const pessoas = useMemo(() => {
    const mapa = new Map<string, { nome: string; email: string | null; proprias: number; compartilhadas: number }>();
    for (const credencial of credenciais) {
      if (credencial.status === 'deleted') continue;
      const dono = mapa.get(credencial.owner_user_id) ?? { nome: credencial.owner_name ?? '—', email: credencial.owner_email, proprias: 0, compartilhadas: 0 };
      dono.proprias += 1;
      mapa.set(credencial.owner_user_id, dono);

      for (const share of credencial.shares) {
        const pessoa = mapa.get(share.user_id) ?? { nome: share.name ?? '—', email: null, proprias: 0, compartilhadas: 0 };
        pessoa.compartilhadas += 1;
        mapa.set(share.user_id, pessoa);
      }
    }
    return [...mapa.entries()].sort((a, b) => a[1].nome.localeCompare(b[1].nome, 'pt-BR'));
  }, [credenciais]);

  if (carregando) return <div className="settings-card py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>;

  return (
    <div className="settings-card">
      <p className="settings-card-title" style={{ margin: '0 0 10px' }}>Quem usa o cofre</p>
      {pessoas.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-[13px]">Ninguém tem chave no cofre ainda.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {pessoas.map(([userId, pessoa]) => (
            <div key={userId} className="flex items-center gap-3 py-2.5">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-none text-[11px] font-bold text-gray-500">
                {iniciais(pessoa.nome)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate">{pessoa.nome}</div>
                {pessoa.email && <div className="text-[11.5px] text-gray-500 truncate">{pessoa.email}</div>}
              </div>
              <div className="text-[11.5px] text-gray-500 text-right whitespace-nowrap">
                <div>{pessoa.proprias} própria(s)</div>
                <div>{pessoa.compartilhadas} recebida(s)</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── aba: compartilhamentos ──────────────────────────────────────────────────

const AbaCompartilhamentos: React.FC<{
  credenciais: VaultAdminCredential[];
  carregando: boolean;
  onRevogar: (credencial: VaultAdminCredential, userId: string, nome: string) => void;
}> = ({ credenciais, carregando, onRevogar }) => {
  const linhas = useMemo(
    () => credenciais
      .filter((c) => c.status !== 'deleted')
      .flatMap((c) => c.shares.map((s) => ({ credencial: c, share: s }))),
    [credenciais],
  );

  if (carregando) return <div className="settings-card py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>;

  return (
    <div className="settings-card">
      <p className="settings-card-title" style={{ margin: '0 0 4px' }}>Compartilhamentos ativos</p>
      <p className="text-[12px] text-gray-500 mb-3">
        Remover aqui vale <strong>imediatamente</strong>: o cofre reconsulta a permissão a cada pedido de código,
        e a extensão não guarda segredo para continuar funcionando sozinha.
      </p>
      {linhas.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-[13px]">Nenhuma chave compartilhada.</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {linhas.map(({ credencial, share }) => (
            <div key={`${credencial.id}:${share.user_id}`} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate">{credencial.name}</div>
                <div className="text-[11.5px] text-gray-500 truncate">
                  {credencial.owner_name ?? '—'} → {share.name ?? 'usuário'}
                </div>
              </div>
              <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${NIVEL_CLS[share.permission] ?? ''}`}>
                {share.permission}
              </span>
              <button
                className="text-[11.5px] text-red-600 hover:underline flex items-center gap-1 bg-transparent"
                onClick={() => onRevogar(credencial, share.user_id, share.name ?? 'este usuário')}
              >
                <Trash2 size={12} /> Revogar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── aba: sessões ────────────────────────────────────────────────────────────
//
// A pergunta que esta aba responde é "o que consegue abrir o cofre agora?".
// Por isso ela nasce escondendo o que já foi revogado: uma sessão morta não é
// risco, é histórico — e histórico já tem a aba de Auditoria.
//
// O caso que a tela existe para pegar: alguém desligado no CRM cuja sessão
// continua de pé. O cofre já recusa esse pedido (a Edge Function reconfere
// `is_active` a cada chamada), mas deixar a linha aberta é sujeira — e ver a
// sujeira é o primeiro passo para limpá-la.

const AbaSessoes: React.FC<{ onNotificar: (t: string, tipo?: 'ok' | 'erro') => void }> = ({ onNotificar }) => {
  const [sessoes, setSessoes] = useState<VaultAdminSession[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [incluirRevogadas, setIncluirRevogadas] = useState(false);
  const [derrubando, setDerrubando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { sessions } = await authenticatorService.adminSessions({ includeRevoked: incluirRevogadas });
      setSessoes(sessions);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível listar os dispositivos.');
    } finally {
      setCarregando(false);
    }
  }, [incluirRevogadas]);

  useEffect(() => { void carregar(); }, [carregar]);

  // A busca por nome roda aqui E no servidor. Aqui é para o filtro responder
  // enquanto se digita, sem uma ida à rede por tecla.
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!termo) return sessoes;
    return sessoes.filter((sessao) => {
      const alvo = `${sessao.user_name ?? ''} ${sessao.user_email ?? ''} ${sessao.device_name ?? ''}`
        .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return alvo.includes(termo);
    });
  }, [sessoes, busca]);

  const orfas = useMemo(
    () => filtradas.filter((sessao) => !sessao.user_is_active && !sessao.revoked_at).length,
    [filtradas],
  );

  const derrubar = async (sessao: VaultAdminSession) => {
    const quem = sessao.user_name ?? sessao.user_email ?? 'este usuário';
    if (sessao.is_current && !window.confirm('Esta é a SUA sessão atual. Derrubá-la desconecta você. Continuar?')) return;
    if (!sessao.is_current && !window.confirm(
      `Derrubar "${sessao.device_name ?? 'dispositivo'}" de ${quem}?\n\n` +
      'O efeito é imediato: a próxima chamada da extensão volta para a tela de login.',
    )) return;

    setDerrubando(sessao.id);
    try {
      await authenticatorService.adminRevokeSession(sessao.id);
      onNotificar('Dispositivo derrubado. A extensão vai pedir login de novo.');
      void carregar();
    } catch (e: any) {
      onNotificar(e?.message ?? 'Não foi possível derrubar o dispositivo.', 'erro');
    } finally {
      setDerrubando(null);
    }
  };

  return (
    <div className="settings-card">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="settings-card-title" style={{ margin: '0 0 4px' }}>Dispositivos conectados</p>
          <p className="text-[12px] text-gray-500 max-w-2xl leading-relaxed">
            Cada linha é uma sessão capaz de pedir código ao cofre. Derrubar aqui vale{' '}
            <strong>na hora</strong> — e nenhum código fica no dispositivo, porque a extensão nunca guarda segredo.
          </p>
        </div>
        <button
          className="settings-btn-ghost flex items-center gap-1.5 text-[11.5px] px-3 py-1"
          onClick={() => void carregar()}
          disabled={carregando}
        >
          {carregando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Atualizar
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="settings-input"
            style={{ paddingLeft: 32 }}
            placeholder="Pessoa ou dispositivo"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-1.5 text-[12px] text-gray-600 whitespace-nowrap">
          <input type="checkbox" checked={incluirRevogadas} onChange={(e) => setIncluirRevogadas(e.target.checked)} />
          Mostrar revogadas
        </label>
      </div>

      {orfas > 0 && (
        <div className="flex items-start gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
          <AlertTriangle size={14} className="flex-none mt-0.5" />
          <span>
            {orfas === 1
              ? 'Há 1 sessão de pé de alguém desativado no CRM.'
              : `Há ${orfas} sessões de pé de pessoas desativadas no CRM.`}{' '}
            O cofre já recusa os pedidos delas — derrube para fechar a conta.
          </span>
        </div>
      )}

      {erro && <p className="text-[12.5px] text-red-600 mb-3 flex items-center gap-1.5"><AlertTriangle size={14} /> {erro}</p>}

      {carregando ? (
        <div className="py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
      ) : filtradas.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-[13px]">
          {busca ? 'Nenhum dispositivo com esse nome.' : 'Nenhum dispositivo conectado.'}
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {filtradas.map((sessao) => (
            <div key={sessao.id} className="flex items-center gap-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-none text-[10px] font-semibold text-gray-600">
                {iniciais(sessao.user_name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-medium truncate flex items-center gap-1.5">
                  {sessao.user_name ?? sessao.user_email ?? 'Usuário removido'}
                  {sessao.is_current && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-700 border-emerald-200 font-semibold">
                      esta sessão
                    </span>
                  )}
                  {!sessao.user_is_active && !sessao.revoked_at && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-100 text-red-600 border-red-200 font-semibold">
                      desativado no CRM
                    </span>
                  )}
                </div>
                <div className="text-[11.5px] text-gray-500 truncate">
                  {sessao.device_name ?? (sessao.kind === 'web' ? 'CRM (navegador)' : 'Extensão')}
                  {' · '}
                  {sessao.last_used_at ? `usada em ${quando(sessao.last_used_at)}` : `criada em ${quando(sessao.created_at)}`}
                  {sessao.revoked_at && ` · revogada em ${quando(sessao.revoked_at)}`}
                  {!sessao.revoked_at && sessao.is_expired && ' · expirada'}
                </div>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-gray-100 text-gray-600 border-gray-200 font-semibold uppercase">
                {sessao.kind === 'web' ? 'CRM' : 'Extensão'}
              </span>
              {sessao.revoked_at ? (
                <span className="text-[11.5px] text-gray-400 whitespace-nowrap">revogada</span>
              ) : (
                <button
                  className="text-[11.5px] text-red-600 hover:underline flex items-center gap-1 bg-transparent whitespace-nowrap disabled:opacity-50"
                  onClick={() => void derrubar(sessao)}
                  disabled={derrubando === sessao.id}
                >
                  {derrubando === sessao.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Derrubar
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── aba: auditoria ──────────────────────────────────────────────────────────

const AbaAuditoria: React.FC = () => {
  const [eventos, setEventos] = useState<VaultAuditEvent[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [tipo, setTipo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const { events } = await authenticatorService.adminAudit({ eventType: tipo || undefined, limit: 200 });
      setEventos(events);
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível ler a auditoria.');
    } finally {
      setCarregando(false);
    }
  }, [tipo]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="settings-card">
      {/* O título ocupava a linha inteira e empurrava o seletor e o botão para
          linhas próprias. Título com o botão à direita, filtro embaixo. */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <p className="settings-card-title" style={{ margin: 0 }}>Registro de atividade</p>
        <button
          className="settings-btn-ghost text-[11.5px] px-3 py-1 flex items-center gap-1.5"
          onClick={() => void carregar()}
          disabled={carregando}
        >
          {carregando ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Atualizar
        </button>
      </div>
      <select className="settings-select text-[12px] py-1 mb-3" value={tipo} onChange={(e) => setTipo(e.target.value)}>
        <option value="">Todos os eventos</option>
        {Object.entries(AUDIT_LABELS).map(([chave, rotulo]) => (
          <option key={chave} value={chave}>{rotulo}</option>
        ))}
      </select>

      <p className="text-[11.5px] text-gray-400 mb-3">
        Este registro é <strong>append-only</strong>: o banco recusa alterar ou apagar uma linha, inclusive para
        administrador. Segredo, código, PIN, senha e token nunca entram aqui.
      </p>

      {erro && <div className="text-[13px] text-red-600 py-2">{erro}</div>}

      {carregando ? (
        <div className="py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>
      ) : eventos.length === 0 ? (
        <div className="py-8 text-center text-gray-400 text-[13px]">Nada registrado neste filtro.</div>
      ) : (
        <div className="divide-y divide-gray-100 max-h-[520px] overflow-y-auto">
          {eventos.map((evento) => (
            <div key={evento.id} className="py-2.5 flex items-start gap-3">
              <div className={`w-1.5 h-1.5 rounded-full mt-2 flex-none ${AUDIT_CRITICAL.has(evento.event_type) ? 'bg-red-500' : 'bg-gray-300'}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">
                  {AUDIT_LABELS[evento.event_type] ?? evento.event_type}
                  {evento.actor_name && <span className="font-normal text-gray-500"> — {evento.actor_name}</span>}
                </div>
                {evento.target_name && evento.target_name !== evento.actor_name && (
                  <div className="text-[11.5px] text-gray-500">Sobre: {evento.target_name}</div>
                )}
                {evento.reason && <div className="text-[11.5px] text-gray-600 italic mt-0.5">“{evento.reason}”</div>}
              </div>
              <div className="text-[11px] text-gray-400 whitespace-nowrap text-right">
                <div>{quando(evento.created_at)}</div>
                {evento.ip && <div className="opacity-70">{evento.ip}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── aba: segurança ──────────────────────────────────────────────────────────

const AbaSeguranca: React.FC<{ versaoAtiva: number | null; onNotificar: (t: string, tipo?: 'ok' | 'erro') => void }> = ({ versaoAtiva, onNotificar }) => {
  const [meta, setMeta] = useState<VaultSecurityMeta | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setMeta(await authenticatorService.adminSecurity());
    } catch (e: any) {
      onNotificar(e?.message ?? 'Não foi possível ler a configuração.', 'erro');
    } finally {
      setCarregando(false);
    }
  }, [onNotificar]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (carregando) return <div className="settings-card py-10 text-center text-gray-400"><Loader2 size={18} className="animate-spin inline" /></div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="settings-card">
        <p className="settings-card-title" style={{ margin: '0 0 4px' }}>PIN de segurança</p>
        <p className="text-[12px] text-gray-500 mb-3 max-w-2xl leading-relaxed">
          O Authenticator usa o <strong>mesmo PIN de segurança do CRM</strong> — aquele que você já cadastra em{' '}
          <strong>Meu Perfil → Segurança</strong>. Não existe um PIN separado para o cofre: seria a mesma pessoa
          com dois segredos de seis dígitos, e trocar um deixaria o outro valendo.
        </p>
        <p className="text-[12px] text-gray-500 mb-3 max-w-2xl leading-relaxed">
          Ele autoriza a recuperação de emergência — <strong>não</strong> é a chave que decifra o cofre. As
          tentativas erradas são contadas junto com as do resto do sistema: cinco erros bloqueiam o PIN por 15
          minutos, aqui e lá.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <span className={`text-[11.5px] px-2 py-1 rounded border font-semibold ${meta?.pin_configured ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
            {meta?.pin_configured ? 'Configurado' : 'Não configurado'}
          </span>
          {meta?.pin_set_at && <span className="text-[11.5px] text-gray-500">desde {quando(meta.pin_set_at)}</span>}
          {meta?.locked_until && new Date(meta.locked_until) > new Date() && (
            <span className="text-[11.5px] text-red-600 flex items-center gap-1">
              <ShieldAlert size={12} /> Bloqueado até {quando(meta.locked_until)}
            </span>
          )}
          <a
            className="settings-btn-ghost text-[12px] px-3 py-1.5 ml-auto no-underline flex items-center gap-1.5"
            href="/perfil?aba=seguranca"
          >
            <Lock size={12} />
            {meta?.pin_configured ? 'Trocar no meu perfil' : 'Cadastrar no meu perfil'}
          </a>
        </div>

        {meta && meta.admins_with_pin <= 1 && (
          <p className="text-[11.5px] text-amber-700 mt-3 flex items-start gap-1.5">
            <AlertTriangle size={13} className="flex-none mt-0.5" />
            {meta.admins_with_pin === 0
              ? 'Nenhum administrador tem PIN cadastrado — a recuperação de emergência está indisponível para todo mundo.'
              : `Só 1 de ${meta.admins_total ?? '?'} administradores tem PIN. Com um único PIN, uma indisponibilidade dessa pessoa trava toda recuperação de emergência.`}
          </p>
        )}
      </div>

      <div className="settings-card">
        <p className="settings-card-title" style={{ margin: '0 0 4px' }}>Criptografia</p>
        <div className="text-[12.5px] text-gray-600 space-y-1.5 mt-2">
          <div className="flex justify-between gap-4"><span className="text-gray-500">Esquema</span><span>AES-256-GCM com DEK próprio por chave (envelope)</span></div>
          <div className="flex justify-between gap-4"><span className="text-gray-500">Chave mestra ativa</span><span>v{versaoAtiva ?? meta?.active_key_version ?? '—'}</span></div>
          <div className="flex justify-between gap-4"><span className="text-gray-500">Versões carregadas</span><span>{(meta?.key_versions ?? []).map((v) => `v${v}`).join(', ') || '—'}</span></div>
        </div>
        <p className="text-[11.5px] text-gray-400 mt-3 leading-relaxed">
          A chave mestra vive só em variável de ambiente da Edge Function. Para rotacionar, publique
          <code className="mx-1 text-[11px]">TOTP_VAULT_MASTER_KEY_V2</code>, aponte
          <code className="mx-1 text-[11px]">TOTP_VAULT_KEY_VERSION=2</code> e rode o reembrulho em lotes — o
          ciphertext do segredo não é recriado, só o DEK muda de embrulho.
        </p>
      </div>

      <div className="settings-card">
        <p className="settings-card-title" style={{ margin: '0 0 4px' }}>Extensão do Chrome</p>
        <div className="flex items-start gap-3 mt-2">
          <Puzzle size={16} className="text-gray-400 mt-0.5 flex-none" />
          <p className="text-[12.5px] text-gray-600 leading-relaxed">
            A extensão usa <strong>as mesmas contas do CRM</strong> — não existe cadastro separado. Desativar
            alguém em <em>Equipe</em> derruba o cofre daquela pessoa na chamada seguinte, sem esperar token
            expirar. As instruções de instalação estão em <code className="text-[11px]">docs/authenticator-deployment.md</code>.
          </p>
        </div>
      </div>

    </div>
  );
};

// ── painel lateral da credencial ────────────────────────────────────────────

const PainelCredencial: React.FC<{
  credencial: VaultAdminCredential;
  onFechar: () => void;
  onRecuperar: (c: VaultAdminCredential) => void;
  onTransferir: (c: VaultAdminCredential) => void;
  onMudou: () => void;
  onNotificar: (t: string, tipo?: 'ok' | 'erro') => void;
}> = ({ credencial, onFechar, onRecuperar, onTransferir, onMudou, onNotificar }) => (
  <div className={`fixed inset-0 ${zc.MODAL} bg-black/50 flex items-center justify-center p-4`} onClick={onFechar}>
    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold truncate">{credencial.name}</h3>
          <p className="text-[12px] text-gray-500 mt-0.5">
            {credencial.issuer ? `${credencial.issuer} · ` : ''}{credencial.algorithm} · {credencial.digits} dígitos · {credencial.period}s
          </p>
        </div>
        <button className="text-gray-400 hover:text-gray-700 bg-transparent" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Proprietário</p>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-[11px] font-bold text-gray-500">
              {iniciais(credencial.owner_name)}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate">{credencial.owner_name ?? '—'}</div>
              <div className="text-[11.5px] text-gray-500 truncate">{credencial.owner_email ?? ''}</div>
            </div>
            <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border font-semibold ${NIVEL_CLS.OWNER}`}>OWNER</span>
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Compartilhada com</p>
          {credencial.shares.length === 0 ? (
            <p className="text-[12.5px] text-gray-400">Ninguém além do proprietário.</p>
          ) : (
            <div className="space-y-1.5">
              {credencial.shares.map((share) => (
                <div key={share.user_id} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                    {iniciais(share.name)}
                  </div>
                  <span className="text-[13px] flex-1 truncate">{share.name ?? 'usuário'}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${NIVEL_CLS[share.permission] ?? ''}`}>{share.permission}</span>
                  <button
                    className="text-[11.5px] text-red-600 hover:underline bg-transparent"
                    onClick={async () => {
                      if (!window.confirm(`Remover o acesso de ${share.name ?? 'este usuário'}?`)) return;
                      try {
                        await authenticatorService.revokeShare(credencial.id, share.user_id);
                        onNotificar('Acesso removido.');
                        onMudou();
                        onFechar();
                      } catch (e: any) {
                        onNotificar(e?.message ?? 'Não foi possível remover.', 'erro');
                      }
                    }}
                  >
                    Revogar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5">
          <div className="flex items-start gap-2">
            <UserCog size={15} className="text-gray-600 flex-none mt-0.5" />
            <div>
              <p className="text-[12.5px] font-semibold text-gray-700">Transferir propriedade</p>
              <p className="text-[11.5px] text-gray-500 mt-0.5 leading-relaxed">
                Para quando o dono saiu do escritório e a chave precisa de um responsável. Exige motivo, PIN e a sua
                senha — e <strong>não pode ser para você</strong>: virar dono daria direito de exportar o segredo sem
                passar pela recuperação de emergência.
              </p>
              <button
                className="settings-btn-ghost text-[11.5px] px-3 py-1 mt-2.5 flex items-center gap-1.5"
                onClick={() => onTransferir(credencial)}
                disabled={credencial.status === 'deleted'}
              >
                <UserCog size={12} /> Escolher novo proprietário
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5">
          <div className="flex items-start gap-2">
            <ShieldAlert size={15} className="text-amber-700 flex-none mt-0.5" />
            <div>
              <p className="text-[12.5px] font-semibold text-amber-800">Recuperação de emergência</p>
              <p className="text-[11.5px] text-amber-800/85 mt-0.5 leading-relaxed">
                Ver este segredo não é parte de administrar o cofre. É procedimento excepcional: exige motivo escrito,
                seu PIN administrativo e a sua senha do CRM, e gera registro permanente com o seu nome.
              </p>
              <button className="settings-btn-ghost text-[11.5px] px-3 py-1 mt-2.5 flex items-center gap-1.5" onClick={() => onRecuperar(credencial)}>
                <Eye size={12} /> Recuperar chave
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ── modal: transferência administrativa ─────────────────────────────────────
//
// Cobra o mesmo preço do break-glass (motivo + PIN + senha) porque o resultado
// é comparável: alguém passa a poder EXPORTAR aquele segredo.
//
// A recusa de transferir para si mesmo é do servidor — aqui ela só aparece
// cedo, para o administrador não escrever um motivo inteiro antes do 403.

const ModalTransferencia: React.FC<{
  credencial: VaultAdminCredential;
  onFechar: () => void;
  onPronto: () => void;
  onNotificar: (t: string, tipo?: 'ok' | 'erro') => void;
}> = ({ credencial, onFechar, onPronto, onNotificar }) => {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<{ user_id: string; name: string; email: string }[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [destino, setDestino] = useState<{ user_id: string; name: string; email: string } | null>(null);
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [senha, setSenha] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [euMesmo, setEuMesmo] = useState<string | null>(null);

  useEffect(() => {
    authenticatorService.me().then((perfil) => setEuMesmo(perfil.user.id)).catch(() => setEuMesmo(null));
  }, []);

  useEffect(() => {
    const alvo = termo.trim();
    if (alvo.length < 2) { setResultados([]); return; }
    let cancelado = false;
    setBuscando(true);
    const timer = window.setTimeout(async () => {
      try {
        const { users } = await authenticatorService.searchUsers(alvo);
        if (!cancelado) setResultados(users.filter((u) => u.user_id !== credencial.owner_user_id));
      } catch {
        if (!cancelado) setResultados([]);
      } finally {
        if (!cancelado) setBuscando(false);
      }
    }, 250);
    return () => { cancelado = true; window.clearTimeout(timer); };
  }, [termo, credencial.owner_user_id]);

  const destinoEhEu = Boolean(destino && euMesmo && destino.user_id === euMesmo);

  const transferir = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro(null);
    if (!destino) return setErro('Escolha para quem a chave vai.');
    if (destinoEhEu) return setErro('Você não pode transferir uma chave para si mesmo. Para ver o segredo, use a recuperação de emergência.');
    if (motivo.trim().length < 15) return setErro('Descreva o motivo em pelo menos 15 caracteres. Ele vai para a auditoria.');

    setProcessando(true);
    try {
      const { step_up_token } = await authenticatorService.stepUp(senha);
      setSenha('');
      await authenticatorService.adminTransfer(credencial.id, destino.user_id, pin, motivo.trim(), step_up_token);
      setPin('');
      onNotificar(`"${credencial.name}" agora é de ${destino.name}.`);
      onPronto();
    } catch (e: any) {
      setSenha(''); setPin('');
      setErro(e?.message ?? 'Não foi possível transferir a chave.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${zc.MODAL_NESTED} bg-black/50 flex items-center justify-center p-4`} onClick={() => !processando && onFechar()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-2">
          <h3 className="text-[15px] font-semibold flex items-center gap-2">
            <UserCog size={16} className="text-gray-600" /> Transferir propriedade
          </h3>
          <button className="text-gray-400 hover:text-gray-700 bg-transparent" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>

        <form className="px-5 pb-5" onSubmit={transferir}>
          <div className="rounded-xl bg-gray-100 p-3 mb-4">
            <div className="text-[13px] font-medium">{credencial.name}</div>
            <div className="text-[11.5px] text-gray-500">
              Hoje é de {credencial.owner_name ?? credencial.owner_email ?? '—'}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <span className="settings-label">Novo proprietário</span>
              {destino ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 p-2.5">
                  <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500">
                    {iniciais(destino.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{destino.name}</div>
                    <div className="text-[11.5px] text-gray-500 truncate">{destino.email}</div>
                  </div>
                  <button type="button" className="text-[11.5px] text-gray-500 hover:underline bg-transparent" onClick={() => { setDestino(null); setTermo(''); }}>
                    trocar
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      className="settings-input"
                      style={{ paddingLeft: 32 }}
                      placeholder="Nome ou e-mail de quem vai receber"
                      value={termo}
                      onChange={(e) => setTermo(e.target.value)}
                    />
                  </div>
                  {buscando && <p className="text-[11.5px] text-gray-400 mt-1.5">Procurando…</p>}
                  {!buscando && resultados.length > 0 && (
                    <div className="border border-gray-200 rounded-xl mt-1.5 max-h-40 overflow-y-auto divide-y divide-gray-100">
                      {resultados.map((usuario) => (
                        <button
                          type="button"
                          key={usuario.user_id}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 bg-transparent flex items-center gap-2"
                          onClick={() => setDestino(usuario)}
                        >
                          <span className="text-[13px] flex-1 truncate">{usuario.name}</span>
                          {euMesmo === usuario.user_id && (
                            <span className="text-[10px] text-red-600 font-semibold whitespace-nowrap">você — não permitido</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {destinoEhEu && (
              <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-xl p-2.5 leading-relaxed">
                Transferir para si mesmo é justamente o atalho que o cofre fecha: como dono, você poderia exportar o
                segredo sem passar pela recuperação de emergência. O servidor recusa.
              </p>
            )}

            <label className="block">
              <span className="settings-label">Motivo (obrigatório, vai para a auditoria)</span>
              <textarea
                className="settings-input"
                rows={3}
                maxLength={500}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: proprietário desligado em 20/08 e a chave precisa de responsável"
                required
              />
            </label>
            <label className="block">
              <span className="settings-label">PIN administrativo</span>
              <input className="settings-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required />
            </label>
            <label className="block">
              <span className="settings-label">Sua senha do CRM</span>
              <input className="settings-input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </label>
          </div>

          {erro && <p className="text-[12.5px] text-red-600 mt-3">{erro}</p>}

          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            O dono anterior <strong>perde</strong> o acesso — a transferência administrativa existe justamente para
            quando ele não deve mais ter. Se precisar que ele continue usando, compartilhe depois pela extensão.
          </p>

          <div className="flex gap-2 mt-4">
            <button type="button" className="settings-btn-ghost flex-1 text-[13px] py-2" onClick={onFechar} disabled={processando}>Cancelar</button>
            <button type="submit" className="settings-btn-primary flex-1 text-[13px] py-2 flex items-center justify-center gap-1.5" disabled={processando || !destino || destinoEhEu}>
              {processando && <Loader2 size={13} className="animate-spin" />} Confirmar transferência
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── modal: recuperação break-glass ──────────────────────────────────────────

const ModalRecuperacao: React.FC<{
  credencial: VaultAdminCredential;
  onFechar: () => void;
  onNotificar: (t: string, tipo?: 'ok' | 'erro') => void;
}> = ({ credencial, onFechar, onNotificar }) => {
  const [motivo, setMotivo] = useState('');
  const [pin, setPin] = useState('');
  const [senha, setSenha] = useState('');
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ secret: string; uri: string } | null>(null);
  const [restante, setRestante] = useState(0);
  const [qr, setQr] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); }, []);

  const recuperar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro(null);
    if (motivo.trim().length < 15) return setErro('Descreva o motivo em pelo menos 15 caracteres. Ele vai para a auditoria.');

    setProcessando(true);
    try {
      const { step_up_token } = await authenticatorService.stepUp(senha);
      setSenha('');
      const dados = await authenticatorService.adminRecover(credencial.id, pin, motivo.trim(), step_up_token);
      setPin('');
      setResultado({ secret: dados.secret, uri: dados.uri });
      setRestante(dados.display_seconds);

      // QR gerado localmente, para o administrador reconfigurar o aplicativo
      // sem digitar o segredo caractere a caractere.
      try {
        setQr(await QRCode.toDataURL(dados.uri, { width: 220, margin: 1 }));
      } catch { setQr(null); }

      timerRef.current = window.setInterval(() => {
        setRestante((anterior) => {
          if (anterior <= 1) {
            if (timerRef.current) window.clearInterval(timerRef.current);
            // Some da tela sozinho: segredo aberto e esquecido num monitor é o
            // vazamento mais barato que existe.
            setResultado(null);
            setQr(null);
            return 0;
          }
          return anterior - 1;
        });
      }, 1000);
    } catch (e: any) {
      setSenha(''); setPin('');
      setErro(e?.message ?? 'Não foi possível recuperar a chave.');
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div className={`fixed inset-0 ${zc.MODAL_NESTED} bg-black/50 flex items-center justify-center p-4`} onClick={() => !processando && onFechar()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 pb-2">
          <h3 className="text-[15px] font-semibold flex items-center gap-2">
            <ShieldAlert size={16} className="text-amber-600" /> Recuperar chave
          </h3>
          <button className="text-gray-400 hover:text-gray-700 bg-transparent" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>

        {!resultado ? (
          <form className="px-5 pb-5" onSubmit={recuperar}>
            <div className="rounded-xl bg-gray-100 p-3 mb-4">
              <div className="text-[13px] font-medium">{credencial.name}</div>
              <div className="text-[11.5px] text-gray-500">Proprietário: {credencial.owner_name ?? credencial.owner_email ?? '—'}</div>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="settings-label">Motivo (obrigatório, vai para a auditoria)</span>
                <textarea
                  className="settings-input"
                  rows={3}
                  maxLength={500}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Ex.: proprietário afastado e servidor precisa ser reconfigurado hoje"
                  required
                />
              </label>
              <label className="block">
                <span className="settings-label">PIN administrativo</span>
                <input className="settings-input" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required />
              </label>
              <label className="block">
                <span className="settings-label">Sua senha do CRM</span>
                <input className="settings-input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
              </label>
            </div>

            {erro && <p className="text-[12.5px] text-red-600 mt-3">{erro}</p>}

            <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
              Cinco PINs errados bloqueiam a recuperação por tempo crescente, e cada tentativa — certa ou errada —
              é registrada com o seu nome, o horário e o IP.
            </p>

            <div className="flex gap-2 mt-4">
              <button type="button" className="settings-btn-ghost flex-1 text-[13px] py-2" onClick={onFechar} disabled={processando}>Cancelar</button>
              <button type="submit" className="settings-btn-primary flex-1 text-[13px] py-2 flex items-center justify-center gap-1.5" disabled={processando}>
                {processando && <Loader2 size={13} className="animate-spin" />} Confirmar recuperação
              </button>
            </div>
          </form>
        ) : (
          <div className="px-5 pb-5">
            <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
              O segredo some da tela em <strong>{restante}s</strong>. A recuperação já está registrada na auditoria
              com o seu nome e o motivo informado.
            </p>

            {qr && <img src={qr} alt="QR Code da credencial recuperada" className="mx-auto rounded-xl border border-gray-200 mb-3" width={220} height={220} />}

            <div className="rounded-xl bg-gray-100 p-3 mb-2 break-all font-mono text-[14px] tracking-wider">{resultado.secret}</div>
            <button
              className="settings-btn-ghost text-[12px] px-3 py-1.5 flex items-center gap-1.5 mb-3"
              onClick={async () => { await navigator.clipboard.writeText(resultado.secret); onNotificar('Segredo copiado.'); }}
            >
              <Copy size={12} /> Copiar segredo
            </button>

            <div className="rounded-xl bg-gray-100 p-3 mb-2 break-all font-mono text-[10.5px] text-gray-600">{resultado.uri}</div>
            <button
              className="settings-btn-ghost text-[12px] px-3 py-1.5 flex items-center gap-1.5"
              onClick={async () => { await navigator.clipboard.writeText(resultado.uri); onNotificar('URI copiada.'); }}
            >
              <Copy size={12} /> Copiar URI otpauth
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthenticatorSettings;
