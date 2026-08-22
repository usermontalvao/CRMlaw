// Painel "Nova conversa" — a agenda, no lugar do modal de busca.
//
// O que mudou em relação ao modal antigo, e por quê:
//
//  · DESLIZA SOBRE A LISTA, não abre no meio da tela. É onde o WhatsApp Web
//    põe essa tela, e não é enfeite: a agenda quer ALTURA, e um diálogo
//    centralizado desperdiça as duas faixas de tela acima e abaixo dele.
//    Escolher com quem falar é a mesma tarefa de escolher uma conversa — por
//    isso acontece na mesma coluna, e não por cima de tudo.
//
//  · A LISTA JÁ VEM CHEIA. O modal antigo abria vazio e só mostrava alguém
//    depois de duas letras digitadas: para achar quem você não sabe soletrar,
//    não servia. Aqui a agenda inteira está aberta, separada por letra, e a
//    busca peneira o que já está na mão.
//
//  · UMA LINHA POR NÚMERO. O WhatsApp lista números; clicar já é escolher por
//    onde falar. Some o passo "qual número usar?" que o modal tinha para quem
//    tem celular e fixo.
//
//  · COM ROSTO E COM SELO. A foto não vem do cadastro (quase ninguém tem): vem
//    do próprio WhatsApp. Para quem já foi atendido, da conversa antiga; para o
//    resto da agenda, perguntando à Evolution na hora em que a linha aparece na
//    tela — e a mesma pergunta responde o que mais importa antes de clicar: se
//    aquele número TEM WhatsApp. Ver `whatsapp-contact-probe`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Loader2, UserPlus, Star, X, MessageCircle, ShieldAlert, Check, Ban } from 'lucide-react';
import { prettyPhone } from './format';
import { ContactAvatar } from './contactAvatar';
import { whatsappService, normalizePhone } from '../../services/whatsapp.service';
import { useToastContext } from '../../contexts/ToastContext';
import { filterContacts, groupByLetter, enterTarget, type ContactEntry } from './contactBook';
import {
  pickInitialChannel, isPreferredChannel, togglePreferred,
  readPreferredChannel, writePreferredChannel,
} from './preferredChannel';
import type { WhatsAppChannel, WhatsAppContactProbe } from '../../types/whatsapp.types';
import type { WhatsAppChannelDepartmentRouting } from '../../services/settings.service';

/** Quantos números cabem numa pergunta à Evolution (o teto é o da Edge Function). */
const LOTE_SONDAGEM = 24;

/** Fileira fantasma enquanto a agenda não chega — no lugar do disco girando. */
const LinhaEsqueleto: React.FC = () => (
  <div className="flex items-center gap-3 px-4 py-2.5">
    <div className="skeleton h-12 w-12 flex-shrink-0 rounded-full" />
    <div className="min-w-0 flex-1 space-y-2">
      <div className="skeleton h-3 w-2/5 rounded" />
      <div className="skeleton h-2.5 w-3/5 rounded" />
    </div>
  </div>
);

export const NewConversationPanel: React.FC<{
  channels: WhatsAppChannel[];
  channelRouting: WhatsAppChannelDepartmentRouting[];
  onClose: () => void;
  onOpened: (conversationId: string) => void;
}> = ({ channels, channelRouting, onClose, onOpened }) => {
  const toast = useToastContext();
  const [query, setQuery] = useState('');
  const [agenda, setAgenda] = useState<ContactEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [preferred, setPreferred] = useState<string | null>(() => readPreferredChannel());
  const [channelId, setChannelId] = useState(() => pickInitialChannel(readPreferredChannel(), channels.map(c => c.id)));
  const [busy, setBusy] = useState(false);
  // Telefone que o atendente clicou sabendo que não tem WhatsApp: a linha pede
  // confirmação em vez de abrir uma conversa por onde nada sai.
  const [confirmarSemWa, setConfirmarSemWa] = useState<string | null>(null);
  // Fechando: o painel recua antes de desmontar (ver `fechar`).
  const [saindo, setSaindo] = useState(false);
  const saindoRef = useRef(false);
  const rolagemRef = useRef<HTMLDivElement>(null);

  // ── Sondagem: foto e "tem WhatsApp?" por número ──
  // Chave: telefone normalizado (com 55). Só entra aqui o que já foi respondido.
  const [probes, setProbes] = useState<Map<string, WhatsAppContactProbe>>(new Map());
  // Números já pedidos (respondidos ou em voo) — para não perguntar duas vezes.
  const jaPedidos = useRef<Set<string>>(new Set());
  // Fila do que apareceu na tela e ainda não foi perguntado.
  const fila = useRef<Set<string>>(new Set());
  const timerFila = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "O painel ainda está de pé?" — guarda para não chamar `setState` depois de
  // desmontado. A bandeira é LEVANTADA na montagem, e não só na declaração do
  // ref: em desenvolvimento o React monta, limpa e monta de novo, e um ref que
  // só nasce `true` fica `false` para sempre depois dessa primeira limpeza.
  // Foi exatamente isso que engoliu em silêncio todas as sondagens — a agenda
  // recebia as respostas e as jogava fora antes de pintar rosto ou selo.
  const vivoRef = useRef(true);
  useEffect(() => {
    vivoRef.current = true;
    return () => { vivoRef.current = false; if (timerFila.current) clearTimeout(timerFila.current); };
  }, []);

  const guardarProbes = useCallback((lista: WhatsAppContactProbe[]) => {
    if (!vivoRef.current || lista.length === 0) return;
    setProbes(atual => {
      const proximo = new Map(atual);
      for (const p of lista) proximo.set(p.phone, p);
      return proximo;
    });
  }, []);

  /**
   * Esvazia a fila em lotes. A pergunta custa uma ida à Evolution POR NÚMERO
   * (a foto), então quem manda o ritmo é o que está na tela: rolar a agenda
   * inteira de uma vez não vira uma varredura no servidor do WhatsApp.
   */
  // O canal escolhido entra na sondagem por REFERÊNCIA, e não por dependência:
  // é ele que muda no meio da vida do painel, e uma dependência aqui recriaria
  // o observador lá embaixo — que se desliga das linhas já pintadas sem que
  // nenhuma delas seja registrada de novo. Trocar de canal deixaria a metade
  // visível da agenda sem foto e sem selo, para sempre.
  const channelIdRef = useRef(channelId);
  useEffect(() => { channelIdRef.current = channelId; }, [channelId]);

  const escoarFila = useCallback(async () => {
    if (!vivoRef.current) return;
    const lote = [...fila.current].slice(0, LOTE_SONDAGEM);
    if (lote.length === 0) return;
    for (const p of lote) fila.current.delete(p);
    const resultado = await whatsappService.probeContacts(lote, channelIdRef.current);
    guardarProbes(resultado);
    if (fila.current.size > 0) void escoarFila();
  }, [guardarProbes]);

  const pedirSondagem = useCallback((phone: string) => {
    const norm = normalizePhone(phone);
    if (!norm || jaPedidos.current.has(norm)) return;
    jaPedidos.current.add(norm);
    fila.current.add(norm);
    if (timerFila.current) clearTimeout(timerFila.current);
    // Espera a rolagem parar: durante um arrastão de scroll, dezenas de linhas
    // entram e saem da tela e só as que ficarem merecem uma pergunta.
    timerFila.current = setTimeout(() => { void escoarFila(); }, 220);
  }, [escoarFila]);

  // Uma linha entrou na tela → entra na fila de sondagem. Um observador só para
  // a lista inteira; cada linha se registra pelo `ref`.
  const observador = useRef<IntersectionObserver | null>(null);
  // Linhas que se registraram antes de o observador existir (o `ref` de um
  // elemento roda na montagem; o efeito, depois dela).
  const aguardandoObservador = useRef<Set<HTMLElement>>(new Set());
  useEffect(() => {
    const io = new IntersectionObserver(entradas => {
      for (const e of entradas) {
        if (!e.isIntersecting) continue;
        const phone = (e.target as HTMLElement).dataset.phone;
        if (phone) pedirSondagem(phone);
        io.unobserve(e.target);
      }
    }, { root: rolagemRef.current, rootMargin: '200px 0px' });
    observador.current = io;
    for (const el of aguardandoObservador.current) io.observe(el);
    aguardandoObservador.current.clear();
    return () => { io.disconnect(); observador.current = null; };
  }, [pedirSondagem]);

  const observarLinha = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (observador.current) observador.current.observe(el);
    else aguardandoObservador.current.add(el);
  }, []);

  // A agenda é buscada UMA VEZ, na abertura. Enquanto o painel estiver de pé
  // ela não muda: buscar de novo a cada tecla é exatamente o que fazia o modal
  // antigo depender do servidor para peneirar. Junto vem o cache de sondagens
  // já feitas — o que o escritório já perguntou uma vez aparece de imediato,
  // com rosto e selo, sem nova ida à Evolution.
  useEffect(() => {
    let vivo = true;
    whatsappService.listContactBook()
      .then(lista => { if (vivo) { setAgenda(lista); setErro(null); } })
      .catch((e: any) => { if (vivo) { setAgenda([]); setErro(e?.message || 'Não foi possível carregar a agenda.'); } });
    whatsappService.listContactProbes()
      .then(lista => {
        if (!vivo) return;
        for (const p of lista) jaPedidos.current.add(p.phone);
        guardarProbes(lista);
      })
      .catch(() => { /* sem cache: as linhas visíveis perguntam do zero */ });
    return () => { vivo = false; };
  }, [guardarProbes]);

  /**
   * Fechar é um movimento, não um corte: o painel recua e só então some.
   * Desmontar de uma vez faz a lista de conversas reaparecer com um estalo — e
   * é justamente na saída que a diferença entre "abriu uma janela" e "voltou
   * uma gaveta" se percebe.
   */
  const fechar = useCallback(() => {
    if (saindoRef.current) return; // clique duplo na seta não empilha timers
    saindoRef.current = true;
    setSaindo(true);
    setTimeout(onClose, 150); // casado com `wa-newconv-out` (0.16s)
  }, [onClose]);

  // Esc fecha, como em qualquer tela sobreposta do módulo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fechar]);

  // Canal pode cair ou reconectar com o painel aberto — `channels` só traz os
  // conectados. Sem isto a seleção apontaria para um id fora da lista.
  useEffect(() => {
    const ids = channels.map(c => c.id);
    setChannelId(atual => (ids.includes(atual) ? atual : pickInitialChannel(preferred, ids)));
  }, [channels, preferred]);

  const filtrados = useMemo(() => filterContacts(agenda || [], query), [agenda, query]);
  const secoes = useMemo(() => groupByLetter(filtrados), [filtrados]);

  // Rolar de volta ao topo a cada peneirada: sem isto, apagar a busca deixava a
  // lista parada no meio do alfabeto, longe do que se acabou de digitar.
  useEffect(() => { rolagemRef.current?.scrollTo({ top: 0 }); }, [query]);

  const digits = query.replace(/\D/g, '');
  const typedPhone = digits.length >= 10 ? normalizePhone(query) : '';
  // Número digitado que JÁ está na agenda não vira oferta avulsa — abrir por ali
  // perderia o vínculo com o cadastro que a linha da agenda carrega.
  const telefoneInedito = typedPhone && !filtrados.some(e => normalizePhone(e.phone) === typedPhone) ? typedPhone : '';

  // Número digitado à mão é o caso em que a pergunta mais importa: ninguém sabe
  // de cor se aquele telefone anotado no papel tem WhatsApp.
  useEffect(() => { if (telefoneInedito) pedirSondagem(telefoneInedito); }, [telefoneInedito, pedirSondagem]);

  const probeDe = useCallback((phone: string) => probes.get(normalizePhone(phone)) || null, [probes]);

  const abrir = async (phone: string, entry: ContactEntry | null) => {
    if (!channelId) { toast.warning('Selecione um canal conectado'); return; }
    setBusy(true);
    try {
      const { conversation_id } = await whatsappService.openConversation({
        phone,
        channelId,
        clientId: entry?.clientId ?? null,
        contactName: entry?.name ?? null,
        departmentId: channelRouting.find(item => item.channel_id === channelId)?.default_department_id || null,
      });
      onOpened(conversation_id);
    } catch (e: any) {
      toast.error('Falha ao abrir conversa', e.message);
    } finally { setBusy(false); }
  };

  /**
   * Clique numa linha. Quando a Evolution já disse que aquele número NÃO tem
   * WhatsApp, o primeiro clique não abre nada: avisa, em dois lugares, e
   * pergunta de novo. Abrir uma conversa por onde nenhuma mensagem sai só
   * produz thread morta na inbox — e o atendente descobriria o problema depois
   * de escrever o texto inteiro.
   *
   * O aviso é duplo de propósito. A linha muda ali, sob o dedo, para quem está
   * olhando para ela; o toast é para quem clicou de passagem e já levou os
   * olhos para outro canto da tela. Um sozinho deixa metade dos casos passar.
   */
  const clicar = (phone: string, entry: ContactEntry | null) => {
    const norm = normalizePhone(phone);
    if (probes.get(norm)?.hasWhatsApp === false && confirmarSemWa !== norm) {
      setConfirmarSemWa(norm);
      toast.warning(
        `${entry?.name || 'Este número'} não tem WhatsApp`,
        `${prettyPhone(norm)} não tem conta ativa no WhatsApp. Nenhuma mensagem sai por aí — clique de novo se quiser abrir a conversa assim mesmo.`,
      );
      return;
    }
    setConfirmarSemWa(null);
    void abrir(phone, entry);
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || busy) return;
    const alvo = enterTarget(telefoneInedito, filtrados);
    if (!alvo) return;
    e.preventDefault();
    if (alvo.kind === 'phone') clicar(alvo.phone, null);
    else clicar(alvo.entry.phone, alvo.entry);
  };

  const marcarPreferido = () => {
    const next = togglePreferred(preferred, channelId);
    writePreferredChannel(next);
    setPreferred(next);
  };

  const carregando = agenda === null;
  const ehPadrao = isPreferredChannel(preferred, channelId);
  const probeDigitado = telefoneInedito ? probes.get(telefoneInedito) : null;

  // Quantos, do que está na tela, já se sabe que não têm WhatsApp. Conta só o
  // que foi respondido: número ainda não sondado não entra na conta, senão o
  // aviso subiria e desceria conforme a rolagem vai perguntando.
  const semWhatsVisiveis = useMemo(
    () => filtrados.reduce((n, e) => (probes.get(normalizePhone(e.phone))?.hasWhatsApp === false ? n + 1 : n), 0),
    [filtrados, probes],
  );

  return (
    <div
      // Cobre a coluna da lista inteira, incluindo o cabeçalho de busca —
      // é ele que o painel SUBSTITUI enquanto está aberto.
      className="wa-newconv absolute inset-0 z-20 flex flex-col bg-white"
      data-saindo={saindo || undefined}
      role="dialog" aria-modal="true" aria-label="Nova conversa"
    >
      {/* Cabeçalho: a seta de voltar, como no WhatsApp. */}
      <div className="relative flex-shrink-0 overflow-hidden bg-gradient-to-br from-[#00a884] to-[#017561] px-4 pb-4 pt-4 text-white shadow-sm">
        {/* Brilho diagonal discreto: dá profundidade à faixa sem custar
            desfoque (que recomporia a barra a cada quadro da rolagem). */}
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex items-center gap-3.5">
          <button onClick={fechar} title="Voltar (Esc)" aria-label="Voltar"
            className="-ml-1 rounded-full p-1.5 transition hover:bg-white/20 active:scale-95">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-tight">Nova conversa</h2>
            <p className="text-[11.5px] leading-tight text-white/70">
              {carregando
                ? 'carregando a agenda…'
                : <>
                    {filtrados.length} {filtrados.length === 1 ? 'contato' : 'contatos'}
                    {/* O total de quem não atende por ali fica no cabeçalho: é o
                        aviso que se lê ANTES de procurar alguém, e não depois de
                        clicar no nome errado. */}
                    {semWhatsVisiveis > 0 && (
                      <span className="ml-1 text-white/90">· {semWhatsVisiveis} sem WhatsApp</span>
                    )}
                  </>}
            </p>
          </div>
        </div>
      </div>

      {/* Busca */}
      <div className="flex-shrink-0 border-b border-[#eceae4] bg-white px-3 py-2.5">
        <div className="group relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition-colors group-focus-within:text-[#00a884]" />
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKeyDown}
            placeholder="Pesquisar nome, CPF/CNPJ ou número"
            className="w-full rounded-full border border-transparent bg-[#f3f2ef] py-2.5 pl-10 pr-9 text-[13px] outline-none transition focus:border-[#00a884]/40 focus:bg-white focus:ring-4 focus:ring-[#00a884]/10" />
          {query && (
            <button onClick={() => setQuery('')} title="Limpar busca" aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Canal — só quando há escolha a fazer. A estrela fixa o padrão. */}
      {channels.length > 1 && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#f1f0ec] bg-[#faf9f7] px-3 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Enviar por</span>
          <select value={channelId} onChange={e => setChannelId(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-[#e2e0d9] bg-white px-2 py-1 text-[12px] text-slate-700 outline-none focus:border-[#00a884]">
            {channels.map(c => <option key={c.id} value={c.id}>{c.name || c.instance_name}</option>)}
          </select>
          <button type="button" onClick={marcarPreferido} disabled={!channelId}
            title={ehPadrao ? 'Este é o canal padrão. Clique para deixar de usá-lo.' : 'Usar este canal como padrão nas próximas conversas'}
            aria-pressed={ehPadrao}
            className={`inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold transition disabled:opacity-40 ${
              ehPadrao ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'text-slate-400 hover:bg-white hover:text-amber-600'
            }`}>
            <Star size={12} fill={ehPadrao ? 'currentColor' : 'none'} />
            Padrão
          </button>
        </div>
      )}

      {/* Agenda */}
      <div ref={rolagemRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* Número que não está na agenda: a saída para quem ainda não é cadastro. */}
        {telefoneInedito && (() => {
          const digitadoSemWa = probeDigitado?.hasWhatsApp === false;
          return (
            <button onClick={() => clicar(telefoneInedito, null)} disabled={busy}
              className={`wa-row-in flex w-full items-center gap-3 border-b border-[#f1f0ec] px-4 py-3 text-left transition-colors duration-150 disabled:opacity-50 ${
                confirmarSemWa === telefoneInedito ? 'bg-red-50' : digitadoSemWa ? 'hover:bg-red-50/60' : 'hover:bg-[#00a884]/[0.07]'
              }`}>
              <span className="relative h-12 w-12 flex-shrink-0">
                <span className={`flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm ring-1 ring-black/5 transition-opacity duration-300 ${
                  digitadoSemWa ? 'from-slate-400 to-slate-500 opacity-60' : 'from-[#00a884] to-[#017561]'
                }`}>
                  <UserPlus size={19} />
                </span>
                {/* Mesmo alvo das linhas da agenda: o número digitado à mão é
                    justamente aquele que ninguém sabe de cor se tem WhatsApp. */}
                {digitadoSemWa && (
                  <span aria-hidden className="absolute -bottom-0.5 -right-0.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-red-500 text-white ring-2 ring-white">
                    <Ban size={10} strokeWidth={2.75} />
                  </span>
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold text-slate-800">
                  {confirmarSemWa === telefoneInedito ? 'Abrir mesmo assim?' : 'Conversar com este número'}
                </p>
                <p className="flex items-center gap-1.5 text-[12px] text-slate-400">
                  {prettyPhone(telefoneInedito)}
                  {probeDigitado?.hasWhatsApp === true && (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-[#017561]"><Check size={11} /> tem WhatsApp</span>
                  )}
                  {digitadoSemWa && (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-red-500"><ShieldAlert size={11} /> sem WhatsApp</span>
                  )}
                  {/* Ponto pulsando em vez de texto parado: diz que ALGO está
                      acontecendo enquanto a Evolution responde. */}
                  {!probeDigitado && (
                    <span className="inline-flex items-center gap-1 text-slate-300">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-slate-300" /> verificando…
                    </span>
                  )}
                </p>
              </div>
            </button>
          );
        })()}

        {carregando ? (
          <div className="pt-1">{Array.from({ length: 8 }).map((_, i) => <LinhaEsqueleto key={i} />)}</div>
        ) : erro ? (
          <p className="px-6 py-12 text-center text-[13px] text-red-600">{erro}</p>
        ) : secoes.length === 0 ? (
          !telefoneInedito && (
            <p className="px-6 py-12 text-center text-[13px] text-slate-400">
              {query.trim()
                ? <>Ninguém na agenda com <strong className="text-slate-500">{query.trim()}</strong>.<br />Digite um número completo para conversar mesmo assim.</>
                : 'Nenhum cliente com telefone cadastrado.'}
            </p>
          )
        ) : (
          // `ordem` é o número da linha na lista inteira (atravessa as seções):
          // é ele que escalona a entrada das primeiras e deixa o resto aparecer
          // pronto. Um contador simples porque o `map` corre em ordem.
          (() => { let ordem = -1; return secoes.map(secao => (
            <div key={secao.letter}>
              {/* Cabeçalho de letra grudado no topo enquanto a seção passa.
                  Fundo sólido de propósito: desfoque em elemento grudento
                  obriga o navegador a recompor a faixa a cada quadro da
                  rolagem (mesma razão do divisor de data da conversa). */}
              <div className="sticky top-0 z-[1] border-b border-[#f4f3ef] bg-white/98 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#00a884]">
                {secao.letter}
              </div>
              {secao.entries.map(entry => {
                const probe = probeDe(entry.phone);
                const semWhats = probe?.hasWhatsApp === false;
                const confirmando = confirmarSemWa === normalizePhone(entry.phone);
                ordem += 1;
                const escalonada = ordem < 12;
                return (
                  <button key={`${entry.clientId}-${entry.phone}`}
                    ref={observarLinha} data-phone={entry.phone}
                    onClick={() => clicar(entry.phone, entry)} disabled={busy}
                    title={semWhats ? `${prettyPhone(entry.phone)} não tem WhatsApp` : undefined}
                    style={escalonada ? { animationDelay: `${ordem * 18}ms` } : undefined}
                    className={`group flex w-full items-center gap-3 px-4 text-left transition-colors duration-150 disabled:opacity-50 ${
                      escalonada ? 'wa-row-in' : ''
                    } ${confirmando ? 'bg-red-50' : 'hover:bg-[#f5f4f1] active:bg-[#eeece7]'}`}>
                    <ContactAvatar name={entry.name} url={probe?.avatarUrl || entry.avatarUrl} semWhats={semWhats} />
                    <div className="min-w-0 flex-1 border-b border-[#f1f0ec] py-2.5">
                      <div className="flex items-center gap-1.5">
                        <p className={`truncate text-[14.5px] ${semWhats ? 'text-slate-400' : 'text-slate-800'}`}>{entry.name}</p>
                        {entry.isPreCadastro && (
                          <span className="flex-shrink-0 rounded bg-slate-100 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-slate-500">
                            pré-cadastro
                          </span>
                        )}
                        {semWhats && (
                          <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded bg-red-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-red-500">
                            <ShieldAlert size={9} /> sem WhatsApp
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[12.5px] text-slate-400">
                        {confirmando
                          ? <span className="font-semibold text-red-500">Este número não tem WhatsApp. Clique de novo para abrir assim mesmo.</span>
                          : <>
                              {prettyPhone(entry.phone)}
                              {entry.phoneKind === 'phone' && <span className="text-slate-300"> · fixo</span>}
                            </>}
                      </p>
                    </div>
                    {/* Só aparece sob o cursor: diz o que o clique faz sem
                        encher a lista de ícones repetidos. Entra deslizando da
                        direita — aparecer no lugar seria um piscar. */}
                    <MessageCircle size={16} aria-hidden
                      className={`mr-1 flex-shrink-0 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 translate-x-1.5 ${
                        semWhats ? 'text-red-400' : 'text-[#00a884]'
                      }`} />
                  </button>
                );
              })}
            </div>
          )); })()
        )}
      </div>

      {busy && (
        <div className="flex flex-shrink-0 items-center justify-center gap-2 border-t border-[#f1f0ec] bg-[#faf9f7] py-2 text-[12px] text-slate-500">
          <Loader2 size={13} className="animate-spin" /> Abrindo conversa…
        </div>
      )}
    </div>
  );
};

export default NewConversationPanel;
