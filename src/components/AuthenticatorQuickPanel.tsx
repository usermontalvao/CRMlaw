import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Loader2, Search, X, Check, Star, Lock, Settings2, Download } from 'lucide-react';
import {
  authenticatorService,
  type VaultCredentialSummary,
} from '../services/authenticator.service';
import { zc } from '../styles/layers';
import AuthenticatorCredentialsManagerModal from './AuthenticatorCredentialsManagerModal';

/**
 * Atalho do Authenticator na barra do CRM.
 *
 * O PIN destrava os códigos por **2 horas** — a duração de um turno, não de um
 * dia. Já foi "toda vez", e era hostil: quem confere quatro códigos numa manhã
 * digitava o PIN quatro vezes. Quem quiser trancar antes tem o botão.
 *
 * A trava é do SERVIDOR, não desta tela: `/codes` recusa sessão do tipo web sem
 * destravamento válido, então abrir o DevTools e chamar a API na mão não pula o
 * PIN. Esta tela é a porta; a fechadura está do outro lado.
 *
 * O destravamento é propriedade da SESSÃO, não um token guardado aqui — por
 * isso ele sobrevive a um F5, e nada sensível precisa morar no navegador.
 *
 * Sobre a entrada do PIN: seis caixas que avançam sozinhas e ENVIAM ao
 * completar. Um PIN tem tamanho conhecido — pedir um clique em "confirmar"
 * depois do sexto dígito é um passo que não decide nada.
 */

const DIGITOS = 6;

const AuthenticatorQuickPanel: React.FC<{ canCreate: boolean; canManage: boolean; canDelete: boolean }> = ({ canCreate, canManage, canDelete }) => {
  const [aberto, setAberto] = useState(false);
  const [destravado, setDestravado] = useState(false);
  const [digitos, setDigitos] = useState<string[]>(() => Array(DIGITOS).fill(''));
  const [conferindo, setConferindo] = useState(false);
  const [checandoStatus, setChecandoStatus] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [tremer, setTremer] = useState(false);

  const [credenciais, setCredenciais] = useState<VaultCredentialSummary[]>([]);
  const [codigos, setCodigos] = useState<Map<string, { code: string; expiraEm: number; period: number }>>(new Map());
  const [busca, setBusca] = useState('');
  const [copiado, setCopiado] = useState<string | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [gerenciamentoAberto, setGerenciamentoAberto] = useState(false);

  /**
   * A extensão já está em uso nesta conta?
   *
   * `null` = ainda não sei, e é DIFERENTE de `false`. Enquanto não sei, o
   * convite de baixar não aparece: mostrá-lo por um instante para quem já tem a
   * extensão é oferecer o que a pessoa já fez, e some sozinho — o pior tipo de
   * piscada, porque parece defeito.
   *
   * O sinal é a SESSÃO de extensão viva no cofre (`kind === 'extension'`), não
   * uma detecção no navegador: a extensão não expõe nada à página (sem content
   * script, sem `web_accessible_resources`), e inventar essa exposição só para
   * esconder um link seria abrir uma janela para fechar uma porta.
   *
   * O preço é conhecido: quem instalou a extensão e ainda não entrou nela uma
   * vez continua vendo o convite. É o lado certo de errar — o convite sobra
   * para quem não terminou de instalar, e nunca falta para quem precisa dele.
   */
  const [temExtensao, setTemExtensao] = useState<boolean | null>(null);

  const recarga = useRef<number | null>(null);
  const painelRef = useRef<HTMLDivElement | null>(null);
  const caixas = useRef<(HTMLInputElement | null)[]>([]);

  /** Trancar de verdade: some com o destravamento no servidor. */
  const trancar = useCallback(() => {
    setDestravado(false);
    setDigitos(Array(DIGITOS).fill(''));
    setErro(null);
    setCredenciais([]);
    setCodigos(new Map());
    setBusca('');
    setGerenciamentoAberto(false);
    setChecandoStatus(false);
    setTemExtensao(null);   // volta a "ainda não sei", não a "não tem"
    if (recarga.current) { window.clearTimeout(recarga.current); recarga.current = null; }
    void authenticatorService.lock().catch(() => {});
  }, []);

  /**
   * Fechar NÃO tranca: o destravamento vale 2 horas, e trancar aqui faria a
   * pessoa digitar o PIN a cada abertura — exatamente o que saiu de cena.
   */
  const fechar = useCallback(() => { setAberto(false); setBusca(''); setGerenciamentoAberto(false); setChecandoStatus(false); }, []);

  useEffect(() => {
    if (!aberto) return;
    const foraDaqui = (e: MouseEvent) => {
      if (painelRef.current && !painelRef.current.contains(e.target as Node)) fechar();
    };
    const noEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    document.addEventListener('mousedown', foraDaqui);
    document.addEventListener('keydown', noEsc);
    return () => {
      document.removeEventListener('mousedown', foraDaqui);
      document.removeEventListener('keydown', noEsc);
    };
  }, [aberto, fechar]);

  // Sair da aba fecha o painel — mas não tranca. Deixar códigos girando na
  // tela às costas de quem levantou da mesa é desnecessário; pedir o PIN de
  // novo por causa disso, também.
  useEffect(() => {
    const aoEsconder = () => { if (document.hidden && aberto) fechar(); };
    document.addEventListener('visibilitychange', aoEsconder);
    return () => document.removeEventListener('visibilitychange', aoEsconder);
  }, [aberto, fechar]);

  useEffect(() => {
    if (aberto && !destravado && !checandoStatus) window.setTimeout(() => caixas.current[0]?.focus(), 60);
  }, [aberto, checandoStatus, destravado]);

  useEffect(() => {
    if (!destravado) return;
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [destravado]);

  const buscarCodigos = useCallback(async () => {
    try {
      const { codes } = await authenticatorService.codes();
      const mapa = new Map<string, { code: string; expiraEm: number; period: number }>();
      let menor = 30;
      for (const c of codes) {
        if (!c.code) continue;
        mapa.set(c.credential_id, {
          code: c.code,
          expiraEm: Date.now() + (c.expires_in ?? 0) * 1000,
          period: c.period ?? 30,
        });
        menor = Math.min(menor, c.expires_in ?? 30);
      }
      setCodigos(mapa);
      // Uma busca por virada de período — não uma por segundo.
      recarga.current = window.setTimeout(() => void buscarCodigos(), Math.max(1, menor) * 1000 + 300);
    } catch (e: any) {
      if (e?.status === 428 || e?.status === 401) {
        setDestravado(false);
        setDigitos(Array(DIGITOS).fill(''));
        setErro('A confirmação expirou. Digite o PIN de novo.');
      }
    }
  }, []);

  /**
   * Uma vez por destravamento, em segundo plano. Falhar aqui deixa `temExtensao`
   * em `null` — o convite some, e é assim que tem de ser: não conseguir
   * perguntar não é motivo para empurrar um download.
   */
  const conferirExtensao = useCallback(async () => {
    try {
      const { sessions } = await authenticatorService.sessions();
      setTemExtensao(sessions.some((s) => s.kind === 'extension' && !s.revoked_at));
    } catch {
      setTemExtensao(null);
    }
  }, []);

  const confirmar = useCallback(async (pin: string) => {
    setErro(null);
    setConferindo(true);
    try {
      await authenticatorService.unlock(pin);
      setDigitos(Array(DIGITOS).fill(''));   // o PIN sai do estado imediatamente
      const { credentials } = await authenticatorService.listMine();
      setCredenciais(credentials);
      setDestravado(true);
      void conferirExtensao();
      await buscarCodigos();
    } catch (e: any) {
      setDigitos(Array(DIGITOS).fill(''));
      setErro(e?.message ?? 'Não foi possível confirmar o PIN.');
      setTremer(true);
      window.setTimeout(() => setTremer(false), 420);
      window.setTimeout(() => caixas.current[0]?.focus(), 60);
    } finally {
      setConferindo(false);
    }
  }, [buscarCodigos, conferirExtensao]);

  /**
   * O destravamento mora no servidor e vale por duas horas. Ao remontar o
   * cabeçalho ou recarregar a página, o estado React nasce fechado; consultar
   * `/auth/unlock` evita pedir um novo PIN enquanto a sessão ainda é válida.
   */
  const recarregarCredenciais = useCallback(async () => {
    const { credentials } = await authenticatorService.listMine();
    setCredenciais(credentials);
  }, []);


  const abrir = useCallback(async () => {
    setAberto(true);

    // Já destravado: não pede PIN de novo, mas RECARREGA a lista. Uma chave
    // compartilhada com você depois que o painel abriu pela primeira vez não
    // apareceria nunca — a lista era a da primeira abertura, e a única saída
    // era recarregar a página. Abrir o painel é exatamente o momento em que a
    // pessoa quer ver o que tem hoje.
    if (destravado) {
      void recarregarCredenciais().catch(() => {});
      return;
    }

    setChecandoStatus(true);
    setErro(null);
    try {
      const status = await authenticatorService.unlockStatus();
      if (!status.unlocked) return;
      const { credentials } = await authenticatorService.listMine();
      setCredenciais(credentials);
      setDestravado(true);
      void conferirExtensao();
      await buscarCodigos();
    } catch (cause: any) {
      if (cause?.status === 401) setErro('Sua sessão expirou. Entre novamente no CRM.');
    } finally {
      setChecandoStatus(false);
    }
  }, [buscarCodigos, conferirExtensao, destravado, recarregarCredenciais]);

  // Clicar no aviso "fulano compartilhou uma chave" abre este painel. O sino
  // não consegue navegar até aqui — o Authenticator não é módulo do menu, é
  // esta gaveta —, então ele grita e quem sabe abrir escuta.
  useEffect(() => {
    const aoPedir = () => { void abrir(); };
    window.addEventListener('jurius:abrir-authenticator', aoPedir);
    return () => window.removeEventListener('jurius:abrir-authenticator', aoPedir);
  }, [abrir]);

  const digitar = (indice: number, bruto: string) => {
    const limpo = bruto.replace(/\D/g, '');
    if (!limpo) {
      setDigitos((atual) => atual.map((d, i) => (i === indice ? '' : d)));
      return;
    }
    setDigitos((atual) => {
      const proximo = [...atual];
      // Colar o PIN inteiro numa caixa só distribui pelas demais.
      for (let i = 0; i < limpo.length && indice + i < DIGITOS; i += 1) {
        proximo[indice + i] = limpo[i];
      }
      const preenchidos = proximo.filter(Boolean).length;
      const foco = Math.min(indice + limpo.length, DIGITOS - 1);
      window.setTimeout(() => caixas.current[foco]?.focus(), 0);
      // Completou: envia. Não há botão para clicar depois.
      if (preenchidos === DIGITOS) window.setTimeout(() => void confirmar(proximo.join('')), 0);
      return proximo;
    });
  };

  const teclar = (indice: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digitos[indice] && indice > 0) {
      e.preventDefault();
      setDigitos((atual) => atual.map((d, i) => (i === indice - 1 ? '' : d)));
      caixas.current[indice - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && indice > 0) caixas.current[indice - 1]?.focus();
    if (e.key === 'ArrowRight' && indice < DIGITOS - 1) caixas.current[indice + 1]?.focus();
  };

  const visiveis = useMemo(() => {
    const normalizar = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const termo = normalizar(busca.trim());
    return credenciais
      .filter((c) => !termo || normalizar(`${c.name} ${c.issuer ?? ''}`).includes(termo))
      .sort((a, b) => {
        if (Boolean(a.favorite) !== Boolean(b.favorite)) return a.favorite ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
      });
  }, [credenciais, busca]);

  const podeAbrirGerenciamento = useMemo(
    () => canCreate || canManage || credenciais.some((credential) => canDelete && credential.is_owner),
    [canCreate, canDelete, canManage, credenciais],
  );

  const copiar = async (id: string, code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiado(id);
      window.setTimeout(() => setCopiado((atual) => (atual === id ? null : atual)), 1500);
    } catch { /* o navegador recusou a área de transferência */ }
  };

  return (
    <div className="relative" ref={painelRef}>
      <style>{`
        @keyframes jq-tremer { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
        @keyframes jq-entrar { from{opacity:0;transform:translateY(-6px) scale(.985)} to{opacity:1;transform:none} }
        .jq-tremer { animation: jq-tremer .4s ease; }
        .jq-painel { animation: jq-entrar .16s ease-out; }
      `}</style>

      <button
        onClick={() => (aberto ? fechar() : void abrir())}
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
          aberto ? 'bg-amber-50 text-amber-600' : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
        }`}
        title="Códigos 2FA"
        aria-haspopup="dialog"
        aria-expanded={aberto}
      >
        <KeyRound className="w-[18px] h-[18px]" />
      </button>

      {aberto && !gerenciamentoAberto && (
        <div
          className={`jq-painel absolute right-0 top-[46px] w-[320px] rounded-2xl border border-[#e7e5df] bg-white ${zc.POPOVER} overflow-hidden`}
          style={{ boxShadow: '0 12px 40px -8px rgba(28,28,30,.22), 0 2px 8px rgba(28,28,30,.06)' }}
          role="dialog"
          aria-label="Códigos 2FA"
        >
          {checandoStatus ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
              <Loader2 size={20} className="animate-spin text-amber-500" />
              <p className="mt-3 text-[12px] text-slate-500">Verificando sua confirmação…</p>
            </div>
          ) : !destravado ? (
            /* ── porta: o PIN ──────────────────────────────────────────── */
            <div className="px-6 pt-7 pb-6 text-center">
              <img src="/logo.png" alt="Jurius" className="mx-auto mb-3.5 h-11 w-11 rounded-2xl object-cover" width={44} height={44} />

              <p className="text-[14px] font-semibold text-slate-900">Confirme seu PIN</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
                O mesmo PIN de segurança do CRM.
              </p>

              <div className={`mt-5 flex justify-center gap-2 ${tremer ? 'jq-tremer' : ''}`}>
                {digitos.map((digito, i) => (
                  <input
                    key={i}
                    ref={(el) => { caixas.current[i] = el; }}
                    className={`h-11 w-[38px] rounded-xl border text-center text-[19px] font-semibold text-slate-900 outline-none transition-all
                      ${erro ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-slate-50/60'}
                      focus:border-amber-400 focus:bg-white focus:ring-[3px] focus:ring-amber-100`}
                    style={{ WebkitTextSecurity: digito ? 'disc' : 'none' } as React.CSSProperties}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={DIGITOS}
                    value={digito}
                    disabled={conferindo}
                    onChange={(e) => digitar(i, e.target.value)}
                    onKeyDown={(e) => teclar(i, e)}
                    onFocus={(e) => e.target.select()}
                    aria-label={`Dígito ${i + 1} do PIN`}
                  />
                ))}
              </div>

              <div className="mt-3.5 min-h-[17px]">
                {conferindo ? (
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-slate-400">
                    <Loader2 size={12} className="animate-spin" /> conferindo
                  </span>
                ) : erro ? (
                  <span className="text-[11.5px] text-red-600">{erro}</span>
                ) : (
                  <span className="text-[11.5px] text-slate-400">A confirmação vale por até 2 horas neste navegador.</span>
                )}
              </div>
            </div>
          ) : (
            /* ── dentro: os códigos ────────────────────────────────────── */
            <>
              <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
                <span className="flex-1 text-[13px] font-semibold text-slate-900">Meus códigos</span>
                {podeAbrirGerenciamento && (
                  <button
                    type="button"
                    onClick={() => setGerenciamentoAberto(true)}
                    className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[10.5px] font-semibold text-amber-700 hover:bg-amber-100"
                  >
                    <Settings2 size={11} /> Gerenciar
                  </button>
                )}
                <button onClick={fechar} className="bg-transparent text-slate-300 hover:text-slate-600" aria-label="Fechar">
                  <X size={15} />
                </button>
              </div>

              {credenciais.length > 5 && (
                <div className="px-4 pb-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-1.5 pl-7 pr-2 text-[12.5px] outline-none focus:border-amber-300 focus:bg-white"
                      placeholder="Procurar"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="max-h-[330px] overflow-y-auto px-2 pb-2">
                {visiveis.length === 0 ? (
                  <p className="py-10 text-center text-[12.5px] text-slate-400">
                    {busca ? 'Nada encontrado.' : 'Nenhuma chave no seu cofre.'}
                  </p>
                ) : (
                  visiveis.map((c) => {
                    const dados = codigos.get(c.id);
                    const restante = dados ? Math.max(0, Math.ceil((dados.expiraEm - agora) / 1000)) : 0;
                    const fracao = dados ? restante / dados.period : 0;
                    const meio = dados ? Math.ceil(dados.code.length / 2) : 0;
                    const acabando = restante <= 5;
                    return (
                      <div
                        key={c.id}
                        className="flex w-full items-center rounded-xl px-1 py-0.5 transition-colors hover:bg-slate-50"
                      >
                        <button
                          type="button"
                          onClick={() => dados && copiar(c.id, dados.code)}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-transparent px-1.5 py-2 text-left"
                          title="Clique para copiar"
                        >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 truncate text-[11.5px] text-slate-500">
                            {c.favorite && <Star size={9} className="flex-none fill-amber-400 text-amber-400" />}
                            <span className="truncate">{c.name}</span>
                          </div>
                          <div
                            className={`mt-0.5 font-mono text-[21px] font-semibold leading-tight tracking-[0.04em] transition-colors ${
                              acabando ? 'text-red-500' : 'text-slate-900'
                            }`}
                            style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
                          >
                            {dados ? (
                              <>
                                {dados.code.slice(0, meio)}
                                <span className="inline-block w-[0.3em]" />
                                {dados.code.slice(meio)}
                              </>
                            ) : (
                              <span className="text-slate-300">······</span>
                            )}
                          </div>
                        </div>

                        {copiado === c.id ? (
                          <span className="flex flex-none items-center gap-1 text-[11px] font-semibold text-emerald-600">
                            <Check size={13} /> copiado
                          </span>
                        ) : dados ? (
                          /* Anel de tempo: dá para ver de relance quanto falta
                             sem precisar ler o número. */
                          <span className="relative flex h-[26px] w-[26px] flex-none items-center justify-center">
                            <svg viewBox="0 0 26 26" className="absolute inset-0 -rotate-90">
                              <circle cx="13" cy="13" r="11" fill="none" strokeWidth="2.5" className="stroke-slate-100" />
                              <circle
                                cx="13" cy="13" r="11" fill="none" strokeWidth="2.5" strokeLinecap="round"
                                className={acabando ? 'stroke-red-400' : 'stroke-amber-400'}
                                strokeDasharray={2 * Math.PI * 11}
                                strokeDashoffset={2 * Math.PI * 11 * (1 - fracao)}
                                style={{ transition: 'stroke-dashoffset 1s linear' }}
                              />
                            </svg>
                            <span
                              className={`text-[9.5px] font-semibold tabular-nums ${acabando ? 'text-red-500' : 'text-slate-400'}`}
                            >
                              {restante}
                            </span>
                          </span>
                        ) : null}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* O convite para levar os códigos para fora do CRM. Só aparece
                  para quem ainda não usa a extensão — ver `temExtensao`. Fica
                  ACIMA do rodapé porque é oferta, não estado da sessão: as duas
                  coisas na mesma linha faziam "trancar agora" competir com um
                  download, e trancar é o que tem pressa. */}
              {temExtensao === false && (
                <a
                  href="/downloads/jurius-authenticator.zip"
                  download
                  className="flex items-center gap-2 border-t border-[#f0eeea] px-4 py-2.5 no-underline hover:bg-amber-50/60"
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-amber-100 text-amber-700">
                    <Download size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-semibold leading-tight text-slate-700">
                      Baixar a extensão do Chrome
                    </span>
                    <span className="block text-[10px] leading-tight text-slate-400">
                      Os mesmos códigos fora do CRM, sem abrir o sistema
                    </span>
                  </span>
                </a>
              )}

              <div className="flex items-center justify-between gap-2 border-t border-[#f0eeea] px-4 py-2">
                <p className="text-[10.5px] leading-relaxed text-slate-400">
                  A confirmação vale por até 2 horas.
                </p>
                <button type="button" onClick={trancar} className="flex items-center gap-1 bg-transparent text-[10.5px] font-semibold text-slate-500 hover:text-amber-700">
                  <Lock size={11} /> Trancar agora
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {gerenciamentoAberto && (
        <AuthenticatorCredentialsManagerModal
          credentials={credenciais}
          canCreate={canCreate}
          canManage={canManage}
          canDelete={canDelete}
          onClose={() => setGerenciamentoAberto(false)}
          onChanged={async (change, credentialIds) => {
            if (change === 'deleted') {
              setCodigos((current) => {
                const next = new Map(current);
                credentialIds.forEach((credentialId) => next.delete(credentialId));
                return next;
              });
            }
            await recarregarCredenciais();
          }}
        />
      )}
    </div>
  );
};

export default AuthenticatorQuickPanel;
