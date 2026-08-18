// Qual microfone e qual alto-falante o CRM usa nesta máquina.
//
// Por que existe: quem atende por voz raramente tem UM dispositivo só. Há o
// headset USB, o microfone da webcam, o alto-falante do monitor e o do
// notebook — e o navegador escolhe sozinho, pelo padrão do sistema. Na prática
// isso significava falar no microfone errado ou, pior, o TOQUE da chamada sair
// no alto-falante do monitor desligado enquanto o headset estava na cabeça: o
// telefone tocava e ninguém ouvia.
//
// A escolha mora AQUI, no navegador (`localStorage`), e não no banco: driver é
// da máquina, não da pessoa. Quem entra de outro computador escolhe de novo — e
// deve mesmo, porque os dispositivos são outros.
//
// Três consumidores, um lugar só:
//   • `services/wacalls/audioBridge` — microfone da ligação e voz do cliente;
//   • `utils/notificationSound`      — o AudioContext compartilhado, que carrega
//                                      o toque da chamada, os avisos de mensagem
//                                      e os sons de ação;
//   • `components/whatsapp/audioDeviceSettings` — o painel que deixa escolher.

import { getContextoTocavel } from './notificationSound';

/** Uma opção da lista, já com rótulo pronto para a tela. */
export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

/** O que o navegador tem a oferecer neste instante. */
export interface AudioDeviceList {
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  /**
   * `true` quando o navegador devolveu a lista com os rótulos em branco — é o
   * que acontece antes de a permissão de microfone ser dada. Os dispositivos
   * existem, mas com nome escondido não dá para escolher entre eles.
   */
  labelsHidden: boolean;
}

const INPUT_KEY = 'wa:audioInput';
const OUTPUT_KEY = 'wa:audioOutput';

/** `default` é o dispositivo do sistema; guardá-lo seria fixar o que já é padrão. */
const SYSTEM_DEFAULT = 'default';

function readKey(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value && value !== SYSTEM_DEFAULT ? value : null;
  } catch { return null; }
}

function writeKey(key: string, id: string | null): void {
  try {
    if (id && id !== SYSTEM_DEFAULT) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch { /* localStorage indisponível — segue no padrão do sistema */ }
}

/** O microfone escolhido, ou `null` para "o que o sistema mandar". */
export function getPreferredInputId(): string | null { return readKey(INPUT_KEY); }

/** O alto-falante escolhido, ou `null` para "o que o sistema mandar". */
export function getPreferredOutputId(): string | null { return readKey(OUTPUT_KEY); }

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    try { listener(); } catch { /* um ouvinte quebrado não derruba os outros */ }
  }
}

/**
 * Avisa quando a escolha muda — inclusive quando quem mudou foi OUTRA janela.
 * O CRM e a janela /atendimento ficam abertos lado a lado o dia inteiro; uma
 * escolha que só valesse na aba onde foi feita seria pior do que nenhuma.
 */
export function onAudioDeviceChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== INPUT_KEY && event.key !== OUTPUT_KEY) return;
    if (event.key === OUTPUT_KEY) applyOutputToSharedContext();
    notify();
  });
}

export function setPreferredInputId(id: string | null): void {
  writeKey(INPUT_KEY, id);
  notify();
}

export function setPreferredOutputId(id: string | null): void {
  writeKey(OUTPUT_KEY, id);
  // O contexto compartilhado é redirecionado NA HORA: o toque da próxima
  // chamada já sai no lugar novo, sem recarregar a página.
  applyOutputToSharedContext();
  notify();
}

/**
 * Restrições do microfone para o `getUserMedia`.
 *
 * `exact` de propósito: com `ideal`, o navegador cai em silêncio para outro
 * microfone quando o escolhido está ocupado ou desconectado, e a pessoa
 * descobre isso no meio da ligação. Com `exact` a falha é explícita, e quem
 * chama decide o que fazer (ver `openMicrophone`).
 */
export function microphoneConstraints(): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    echoCancellation: true, noiseSuppression: true, autoGainControl: true,
  };
  const deviceId = getPreferredInputId();
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : base;
}

/**
 * `true` se este navegador deixa escolher a SAÍDA.
 *
 * Chrome e Edge deixam (`setSinkId`); Firefox e Safari não expõem a API — lá o
 * áudio sai sempre no padrão do sistema e o painel diz isso em vez de oferecer
 * um campo que não faria nada.
 */
export function supportsOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined'
    && typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === 'function';
}

/** Lista microfones e alto-falantes disponíveis agora. */
export async function listAudioDevices(): Promise<AudioDeviceList> {
  const vazio: AudioDeviceList = { inputs: [], outputs: [], labelsHidden: false };
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return vazio;

  let devices: MediaDeviceInfo[];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return vazio; }

  const inputs: AudioDeviceOption[] = [];
  const outputs: AudioDeviceOption[] = [];
  let semRotulo = false;

  for (const device of devices) {
    if (device.kind !== 'audioinput' && device.kind !== 'audiooutput') continue;
    // Sem permissão, o navegador devolve o dispositivo com `label` vazio. Só o
    // `default` costuma vir nomeado, e é por isso que a lista precisa avisar.
    if (!device.label) semRotulo = true;
    const alvo = device.kind === 'audioinput' ? inputs : outputs;
    alvo.push({
      deviceId: device.deviceId,
      label: device.label || (device.deviceId === SYSTEM_DEFAULT
        ? 'Dispositivo padrão do sistema'
        : `${device.kind === 'audioinput' ? 'Microfone' : 'Alto-falante'} ${alvo.length + 1}`),
    });
  }

  return { inputs, outputs, labelsHidden: semRotulo };
}

/**
 * Pede a permissão de microfone só para revelar os NOMES dos dispositivos.
 *
 * O fluxo natural — abrir o painel, ver "Microfone 1" e "Microfone 2" e ter de
 * adivinhar — é inútil. Este atalho abre e fecha o microfone na hora; o pedido
 * do navegador aparece, os rótulos passam a existir e nada fica gravando.
 */
export async function revealDeviceLabels(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch { return false; }
}

type ComSink = { setSinkId?: (id: string) => Promise<void> };

/**
 * Manda o áudio de um `<audio>`/`<video>` para o alto-falante escolhido.
 * Silenciosa por definição: onde a API não existe, o som continua saindo no
 * padrão do sistema, que é exatamente o comportamento de antes.
 */
export async function applyOutputToElement(el: HTMLMediaElement): Promise<void> {
  const deviceId = getPreferredOutputId();
  if (!deviceId) return;
  const alvo = el as HTMLMediaElement & ComSink;
  if (typeof alvo.setSinkId !== 'function') return;
  try { await alvo.setSinkId(deviceId); } catch { /* dispositivo sumiu — volta ao padrão */ }
}

// ── O contexto compartilhado ────────────────────────────────────────────────
//
// Um único AudioContext carrega TODO o som sintetizado do CRM: os avisos de
// mensagem, os sons de ação e o toque das chamadas (ver `notificationSound`).
// Apontá-lo para o alto-falante escolhido é, portanto, o que faz a preferência
// valer para os três de uma vez.
//
// A direção da dependência é esta e não a contrária de propósito:
// `notificationSound.ts` não importa nada, e é o que permite que o teste dele
// rode no ts-node (import relativo sem extensão quebra a resolução ESM).

let sinkAplicadoEm: AudioContext | null = null;
let sinkAplicadoPara: string | null = null;

/** Redireciona o contexto compartilhado para o alto-falante escolhido. */
export function applyOutputToSharedContext(): void {
  const ac = getContextoTocavel();
  if (!ac) return;
  const desejado = getPreferredOutputId() ?? '';
  // `setSinkId` repetido com o mesmo valor é trabalho à toa — e isto aqui é
  // chamado a cada gesto do usuário.
  if (sinkAplicadoEm === ac && sinkAplicadoPara === desejado) return;
  const comSink = ac as AudioContext & ComSink;
  if (typeof comSink.setSinkId !== 'function') return;
  sinkAplicadoEm = ac;
  sinkAplicadoPara = desejado;
  void comSink.setSinkId(desejado).catch(() => {
    // Dispositivo desapareceu: o som volta ao padrão do sistema. Zerar a marca
    // faz a próxima tentativa acontecer, para o headset religado voltar a valer.
    sinkAplicadoEm = null;
  });
}

// O contexto compartilhado só nasce no PRIMEIRO GESTO do usuário (antes disso o
// navegador o criaria suspenso). O `setTimeout` garante que este código rode
// depois do ouvinte que o cria, sem depender da ordem de registro entre os dois
// módulos. A partir daí, cada gesto reconfere — barato, porque a comparação
// acima corta quando nada mudou.
if (typeof window !== 'undefined') {
  const conferir = () => window.setTimeout(() => applyOutputToSharedContext(), 0);
  window.addEventListener('pointerdown', conferir, { passive: true });
  window.addEventListener('keydown', conferir, { passive: true });
}
