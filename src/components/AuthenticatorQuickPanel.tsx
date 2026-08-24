import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyRound, Search, X, Check, Star, Lock, Settings2, Download } from 'lucide-react';
import {
  authenticatorService,
  type VaultCredentialSummary,
} from '../services/authenticator.service';
import { zc } from '../styles/layers';
import { detectarExtensaoAuthenticator } from '../utils/authenticatorExtension';
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
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [favoritando, setFavoritando] = useState<string | null>(null);
  const [agora, setAgora] = useState(Date.now());
  const [gerenciamentoAberto, setGerenciamentoAberto] = useState(false);

  /**
   * A extensão está instalada NESTE navegador?
   *
   * `null` = ainda não sei, e é DIFERENTE de `false`. Enquanto não sei, o
   * convite de baixar não aparece: mostrá-lo por um instante para quem já tem a
   * extensão é oferecer o que a pessoa já fez, e some sozinho — o pior tipo de
   * piscada, porque parece defeito.
   *
   * Antes isto olhava as sessões da CONTA. Bastava usar a extensão no Chrome
   * do trabalho para o convite sumir também no Safari, no Edge e em qualquer
   * outro computador. Agora a página tenta carregar somente o ícone público
   * que o manifest libera ao domínio do CRM. Não há content script, leitura da
   * página, token ou troca de mensagens nessa detecção.
   */
  const [temExtensao, setTemExtensao] = useState<boolean | null>(null);

  const recarga = useRef<number | null>(null);
  const painelRef = useRef<HTMLDivElement | null>(null);
  const buscaRef = useRef<HTMLInputElement | null>(null);
  const caixas = useRef<(HTMLInputElement | null)[]>([]);

  /** Trancar de verdade: some com o destravamento no servidor. */
  const trancar = useCallback(() => {
    setDestravado(false);
    setDigitos(Array(DIGITOS).fill(''));
    setErro(null);
    setCredenciais([]);
    setCodigos(new Map());
    setBusca('');
    setBuscaAberta(false);
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
  const fechar = useCallback(() => {
    setAberto(false);
    setBusca('');
    setBuscaAberta(false);
    setGerenciamentoAberto(false);
    setChecandoStatus(false);
  }, []);

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
   * Uma vez por destravamento, em segundo plano. A resposta pertence a este
   * navegador; nenhuma sessão da conta em outro dispositivo interfere nela.
   */
  const conferirExtensao = useCallback(async () => {
    try {
      setTemExtensao(await detectarExtensaoAuthenticator());
    } catch {
      setTemExtensao(false);
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

  // A extensão usa UM relógio para todos os códigos do período dominante. Os
  // TOTPs de 30 segundos viram juntos; repetir o mesmo anel em cada linha só
  // multiplica ruído. Chave com período diferente mantém o anel próprio.
  const periodoDominante = useMemo(() => {
    const contagem = new Map<number, number>();
    for (const dados of codigos.values()) {
      contagem.set(dados.period, (contagem.get(dados.period) ?? 0) + 1);
    }
    let periodo = 30;
    let maior = 0;
    for (const [candidato, quantidade] of contagem) {
      if (quantidade > maior) { periodo = candidato; maior = quantidade; }
    }
    return periodo;
  }, [codigos]);

  const relogioCompartilhado = useMemo(() => {
    const doPeriodo = [...codigos.values()].filter((dados) => dados.period === periodoDominante);
    if (doPeriodo.length === 0) return { restante: 0, fracao: 0 };
    const expiraEm = Math.min(...doPeriodo.map((dados) => dados.expiraEm));
    const restante = Math.max(0, Math.ceil((expiraEm - agora) / 1000));
    return { restante, fracao: Math.max(0, Math.min(1, restante / periodoDominante)) };
  }, [agora, codigos, periodoDominante]);

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

  const alternarFavorito = async (credencial: VaultCredentialSummary) => {
    if (favoritando) return;
    const proximo = !credencial.favorite;
    setFavoritando(credencial.id);
    setCredenciais((atuais) => atuais.map((item) => (
      item.id === credencial.id ? { ...item, favorite: proximo } : item
    )));
    try {
      await authenticatorService.favorite(credencial.id, proximo);
    } catch {
      setCredenciais((atuais) => atuais.map((item) => (
        item.id === credencial.id ? { ...item, favorite: credencial.favorite } : item
      )));
    } finally {
      setFavoritando(null);
    }
  };

  return (
    <div className="relative" ref={painelRef}>
      <style>{`
        @keyframes jq-tremer { 0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
        @keyframes jq-entrar { from{opacity:0;transform:translateY(-6px) scale(.985)} to{opacity:1;transform:none} }
        @keyframes jq-marca-entrar { from{opacity:0;transform:translateY(4px) scale(.94)} to{opacity:1;transform:none} }
        @keyframes jq-halo { 0%,100%{opacity:.34;transform:scale(.82)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes jq-ponto { 0%,62%,100%{opacity:.22;transform:scale(.7)} 30%{opacity:1;transform:scale(1.08)} }
        .jq-tremer { animation: jq-tremer .4s ease; }
        .jq-painel { animation: jq-entrar .16s ease-out; }
        .jq-loader-marca { position:relative;width:58px;height:58px;display:grid;place-items:center; }
        .jq-loader-marca::before { content:'';position:absolute;inset:-21px;border-radius:999px;background:radial-gradient(circle,rgba(249,115,22,.17),transparent 68%);animation:jq-halo 2.8s ease-in-out infinite; }
        .jq-loader-marca img { position:relative;z-index:1;width:58px;height:58px;border-radius:14px;filter:drop-shadow(0 9px 16px rgba(249,115,22,.18));animation:jq-marca-entrar .38s cubic-bezier(.16,1,.3,1) both; }
        .jq-loader-pontos { display:flex;align-items:center;justify-content:center;gap:8px;height:9px; }
        .jq-loader-pontos i { display:block;width:7px;height:7px;border-radius:999px;background:#f97316;box-shadow:0 3px 9px rgba(249,115,22,.22);animation:jq-ponto 1.35s ease-in-out infinite; }
        .jq-loader-pontos i:nth-child(2) { animation-delay:.17s; }
        .jq-loader-pontos i:nth-child(3) { animation-delay:.34s; }
        .jq-loader-pontos--compactos { gap:5px;height:7px; }
        .jq-loader-pontos--compactos i { width:5px;height:5px;box-shadow:none; }
        .jq-chave { position:relative;transition:background 130ms cubic-bezier(.2,.8,.3,1); }
        .jq-chave:hover,.jq-chave:focus-within { background:#faf7f4; }
        .jq-chave:hover::before,.jq-chave:focus-within::before { content:'';position:absolute;left:0;top:4px;bottom:4px;width:2px;border-radius:0 2px 2px 0;background:#f97316; }
        .jq-favorito { opacity:0;transition:opacity 130ms cubic-bezier(.2,.8,.3,1),background 130ms cubic-bezier(.2,.8,.3,1),color 130ms cubic-bezier(.2,.8,.3,1); }
        .jq-chave:hover .jq-favorito,.jq-chave:focus-within .jq-favorito,.jq-favorito--marcado { opacity:1; }
        @media (hover:none) { .jq-favorito { opacity:1; } }
        @media (prefers-reduced-motion:reduce) {
          .jq-loader-marca::before,.jq-loader-marca img,.jq-loader-pontos i { animation:none; }
          .jq-loader-marca::before { opacity:.55; }
          .jq-loader-pontos i { opacity:.35; }
          .jq-loader-pontos i:nth-child(2) { opacity:.68; }
          .jq-loader-pontos i:nth-child(3) { opacity:1; }
        }
      `}</style>

      <button
        onClick={() => (aberto ? fechar() : void abrir())}
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
          aberto ? 'bg-orange-50 text-orange-600' : 'text-slate-500 hover:text-orange-600 hover:bg-orange-50'
        }`}
        title="Códigos 2FA"
        aria-label="Authenticator — códigos 2FA"
        aria-haspopup="dialog"
        aria-expanded={aberto}
      >
        <KeyRound className="h-[18px] w-[18px]" />
      </button>

      {aberto && !gerenciamentoAberto && (
        <div
          className={`jq-painel absolute right-0 top-[46px] w-[380px] max-w-[calc(100vw-24px)] rounded-2xl border border-[#e7e5df] bg-white ${zc.POPOVER} overflow-hidden`}
          style={{ boxShadow: '0 12px 40px -8px rgba(28,28,30,.22), 0 2px 8px rgba(28,28,30,.06)' }}
          role="dialog"
          aria-label="Códigos 2FA"
        >
          {checandoStatus ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-6 px-6 text-center" role="status" aria-label="Verificando sua confirmação">
              <div className="jq-loader-marca">
                <img src="/logo.png" alt="" width={58} height={58} />
              </div>
              <span className="jq-loader-pontos" aria-hidden="true"><i /><i /><i /></span>
            </div>
          ) : !destravado ? (
            /* ── porta: o PIN ──────────────────────────────────────────── */
            <div className="px-6 pt-7 pb-6 text-center">
              <img src="/logo.png" alt="Jurius" className="mx-auto mb-3.5 h-12 w-12 rounded-[13px] object-cover drop-shadow-[0_8px_14px_rgba(249,115,22,.16)]" width={48} height={48} />

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
                      focus:border-orange-400 focus:bg-white focus:ring-[3px] focus:ring-orange-100`}
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
                  <span className="inline-flex items-center gap-2 text-[11.5px] text-slate-400" role="status">
                    <span className="jq-loader-pontos jq-loader-pontos--compactos" aria-hidden="true"><i /><i /><i /></span>
                    conferindo
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
              <div className="flex items-center gap-1 px-3.5 pt-3.5">
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-[-0.012em] text-[#15120f]">
                  Authenticator <em className="font-normal not-italic text-[#8b7e74]">· Jurius</em>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setBuscaAberta((atual) => {
                      const proxima = !atual;
                      if (proxima) window.setTimeout(() => buscaRef.current?.focus(), 0);
                      else setBusca('');
                      return proxima;
                    });
                  }}
                  className={`grid h-7 w-7 place-items-center rounded-lg bg-transparent hover:bg-[#f4f0ec] hover:text-[#15120f] ${buscaAberta ? 'bg-[#f4f0ec] text-[#15120f]' : 'text-[#8b7e74]'}`}
                  title="Buscar"
                  aria-label="Buscar chave"
                >
                  <Search size={15} />
                </button>
                {podeAbrirGerenciamento && (
                  <button
                    type="button"
                    onClick={() => setGerenciamentoAberto(true)}
                    className="grid h-7 w-7 place-items-center rounded-lg bg-transparent text-[#8b7e74] hover:bg-[#f4f0ec] hover:text-[#15120f]"
                    title="Gerenciar chaves"
                    aria-label="Gerenciar chaves"
                  >
                    <Settings2 size={15} />
                  </button>
                )}
                <button onClick={fechar} className="grid h-7 w-7 place-items-center rounded-lg bg-transparent text-[#8b7e74] hover:bg-[#f4f0ec] hover:text-[#15120f]" aria-label="Fechar">
                  <X size={15} />
                </button>
              </div>

              {/* Mesmo relógio compartilhado da extensão: os códigos TOTP do
                  período dominante viram juntos, então uma barra basta. */}
              <div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-2.5">
                <span className="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#ede7e1]">
                  <i
                    className={`block h-full rounded-full transition-[width,background-color] duration-300 ease-linear ${relogioCompartilhado.restante <= 7 ? 'bg-red-500' : 'bg-orange-500'}`}
                    style={{ width: `${relogioCompartilhado.fracao * 100}%` }}
                  />
                </span>
                <span className={`text-[10.5px] font-medium tabular-nums transition-colors duration-300 ${relogioCompartilhado.restante <= 7 ? 'text-red-500' : 'text-[#8b7e74]'}`}>
                  {relogioCompartilhado.restante}s
                </span>
              </div>

              {buscaAberta && (
                <div className="px-3.5 pb-2.5">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#8b7e74]" />
                    <input
                      ref={buscaRef}
                      className="h-8 w-full rounded-[9px] border border-[#ede7e1] bg-[#faf7f4] pl-7 pr-2 text-[12.5px] text-[#15120f] outline-none placeholder:text-[#8b7e74] focus:border-[#8b7e74] focus:bg-white"
                      placeholder="Buscar chave"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="max-h-[330px] overflow-y-auto pb-1">
                {visiveis.length === 0 ? (
                  <p className="py-10 text-center text-[12.5px] text-slate-400">
                    {busca ? 'Nada encontrado.' : 'Nenhuma chave no seu cofre.'}
                  </p>
                ) : (
                  visiveis.map((c, indice) => {
                    const dados = codigos.get(c.id);
                    const restante = dados ? Math.max(0, Math.ceil((dados.expiraEm - agora) / 1000)) : 0;
                    const fracao = dados ? restante / dados.period : 0;
                    const meio = dados ? Math.ceil(dados.code.length / 2) : 0;
                    const acabando = restante <= 7;
                    const periodoProprio = !!dados && dados.period !== periodoDominante;
                    const tituloGrupo = indice === 0 && c.favorite
                      ? 'Favoritas'
                      : !c.favorite && indice > 0 && visiveis[indice - 1]?.favorite
                        ? 'Todas as chaves'
                        : null;
                    return (
                      <React.Fragment key={c.id}>
                        {tituloGrupo && (
                          <div className="px-3.5 pb-0.5 pt-2 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-[#8b7e74]/70">
                            {tituloGrupo}
                          </div>
                        )}
                        <div className="jq-chave flex w-full items-center">
                          <button
                            type="button"
                            onClick={() => dados && copiar(c.id, dados.code)}
                            className="flex min-w-0 flex-1 items-center gap-3 bg-transparent px-3.5 py-2 text-left outline-none"
                            title="Copiar código"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1 truncate text-[11.5px] text-[#8b7e74]">
                                <b className="truncate font-medium text-[#5c5148]">{c.name}</b>
                                {(c.account_label || c.issuer) && <><span>·</span><span className="truncate">{c.account_label || c.issuer}</span></>}
                                {periodoProprio && <><span>·</span><span>{dados.period}s</span></>}
                              </div>
                              {copiado === c.id ? (
                                <div className="mt-0.5 flex items-center gap-2 text-[15px] font-medium leading-[1.14] text-emerald-600">
                                  <Check size={19} strokeWidth={2.4} /> Copiado
                                </div>
                              ) : (
                                <div
                                  className={`mt-0.5 flex items-baseline gap-[0.31em] whitespace-nowrap text-[27px] font-semibold leading-[1.14] tracking-[0.004em] transition-colors ${
                                    acabando ? 'text-red-600' : 'text-blue-600'
                                  }`}
                                  style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
                                >
                                  {dados ? (
                                    <>
                                      {dados.code.slice(0, meio)}
                                      {dados.code.slice(meio)}
                                    </>
                                  ) : (
                                    <span className="text-[#8b7e74]/40">······</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {periodoProprio && (
                              /* Como na extensão, só a exceção ganha anel próprio. */
                              <span className="relative flex h-[22px] w-[22px] flex-none items-center justify-center">
                                <svg viewBox="0 0 22 22" className="absolute inset-0 -rotate-90">
                                  <circle cx="11" cy="11" r="8" fill="none" strokeWidth="2.6" className="stroke-[#ede7e1]" />
                                  <circle
                                    cx="11" cy="11" r="8" fill="none" strokeWidth="2.6" strokeLinecap="round"
                                    className={acabando ? 'stroke-red-400' : 'stroke-orange-400'}
                                    strokeDasharray={2 * Math.PI * 8}
                                    strokeDashoffset={2 * Math.PI * 8 * (1 - fracao)}
                                    style={{ transition: 'stroke-dashoffset 1s linear, stroke 300ms ease' }}
                                  />
                                </svg>
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void alternarFavorito(c)}
                            disabled={favoritando !== null}
                            className={`jq-favorito mr-3.5 grid h-7 w-7 flex-none place-items-center rounded-lg bg-transparent ${
                              c.favorite
                                ? 'jq-favorito--marcado text-orange-500 hover:bg-[#f4f0ec]'
                                : 'text-[#8b7e74] hover:bg-[#f4f0ec] hover:text-[#15120f]'
                            } disabled:cursor-wait disabled:opacity-50`}
                            title={c.favorite ? 'Remover dos favoritos' : 'Favoritar'}
                            aria-label={c.favorite ? `Remover ${c.name} dos favoritos` : `Favoritar ${c.name}`}
                            aria-pressed={c.favorite}
                          >
                            <Star size={15} className={c.favorite ? 'fill-current' : ''} />
                          </button>
                        </div>
                      </React.Fragment>
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
                  className="flex items-center gap-2 border-t border-[#f0eeea] px-4 py-2.5 no-underline hover:bg-orange-50/60"
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-orange-100 text-orange-700">
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

              <div className="flex items-center gap-2 border-t border-[#f0eeea] px-3.5 py-2 text-[10.5px] text-[#8b7e74]">
                <span className="h-[5px] w-[5px] flex-none rounded-full bg-emerald-600" aria-hidden="true" />
                <span>Cofre destravado</span>
                <button type="button" onClick={trancar} className="ml-auto flex items-center gap-1 bg-transparent font-semibold text-[#8b7e74] hover:text-orange-700">
                  <Lock size={11} /> Trancar
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
