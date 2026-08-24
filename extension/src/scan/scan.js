// Leitura de QR pela CÂMERA, numa janela própria.
//
// Por que uma janela separada, e não dentro do popup: o popup da extensão
// fecha assim que perde o foco — e a caixa de permissão da câmera do Chrome
// TIRA o foco dele. O pedido morreria junto com a janela, sempre, e o usuário
// veria a permissão piscar e nada acontecer. Numa janela normal a permissão se
// comporta como em qualquer site, e fica lembrada para a extensão.
//
// O que esta tela NÃO faz:
//   • não grava vídeo, não tira foto, não guarda quadro nenhum;
//   • não fala com a rede — quem fala é o service worker;
//   • não escreve o conteúdo do QR em log nenhum.
//
// O quadro vira bitmap, é decodificado e descartado no mesmo passo.

import { tentarLerQr, juntarPayload } from '../lib/qr.js';

const $ = (seletor) => document.querySelector(seletor);
const video = $('#video');

let fluxo = null;
let rodando = false;
let concluido = false;

function estado(texto, achou = false) {
  const alvo = $('#estado');
  alvo.textContent = texto;
  alvo.classList.toggle('achou', achou);
}

function erro(texto) {
  const alvo = $('#erro');
  alvo.textContent = texto;
  alvo.classList.remove('oculto');
}

/** Desliga a câmera de verdade — a luz do equipamento tem de apagar. */
function desligar() {
  rodando = false;
  for (const trilha of fluxo?.getTracks() ?? []) trilha.stop();
  fluxo = null;
  video.srcObject = null;
}

function mensagemDeFalha(falha) {
  switch (falha?.name) {
    case 'NotAllowedError':
      return 'Acesso à câmera negado. Libere a câmera para esta extensão e abra de novo.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Nenhuma câmera encontrada neste computador.';
    case 'NotReadableError':
      return 'A câmera está ocupada por outro programa. Feche-o e tente de novo.';
    default:
      return 'Não foi possível abrir a câmera.';
  }
}

async function listarCameras() {
  // Só depois da permissão os rótulos deixam de vir vazios — por isso esta
  // lista é montada DEPOIS do primeiro getUserMedia, nunca antes.
  const dispositivos = await navigator.mediaDevices.enumerateDevices();
  const cameras = dispositivos.filter((d) => d.kind === 'videoinput');
  if (cameras.length < 2) return;

  const seletor = $('#camera');
  seletor.replaceChildren();
  cameras.forEach((camera, indice) => {
    const opcao = document.createElement('option');
    opcao.value = camera.deviceId;
    opcao.textContent = camera.label || `Câmera ${indice + 1}`;
    seletor.append(opcao);
  });
  if (fluxo) {
    const atual = fluxo.getVideoTracks()[0]?.getSettings?.().deviceId;
    if (atual) seletor.value = atual;
  }
  $('#camera-escolha').classList.remove('oculto');
}

async function abrirCamera(deviceId) {
  desligar();
  // Resolução alta importa: o QR de migração do Google Authenticator é denso,
  // e a 640×480 ele simplesmente não fecha.
  const video_ = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
    : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };

  fluxo = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
  video.srcObject = fluxo;
  await video.play();
}

async function achou(textos) {
  concluido = true;
  desligar();
  estado('QR lido. Analisando…', true);

  const resposta = await chrome.runtime.sendMessage({
    acao: 'qrDaCamera',
    dados: { payload: juntarPayload(textos) },
  });

  if (resposta?.erro) {
    concluido = false;
    erro(resposta.erro);
    estado('Não deu para usar este QR.');
    return;
  }

  const quantas = resposta?.resultado?.total ?? 0;
  estado(quantas === 1 ? '1 conta encontrada.' : `${quantas} contas encontradas.`, true);
  $('#erro').classList.add('oculto');

  // A janela NÃO se fecha sozinha.
  //
  // Fechar no susto era pior de todos os jeitos: some antes de a pessoa ler
  // quantas contas apareceram, e some sem dizer o que fazer em seguida. Quem
  // decide quando fechar é quem está olhando.
  const pronto = $('#pronto');
  $('#pronto-texto').textContent = quantas === 1
    ? 'Encontrei 1 conta. Abra o Jurius Authenticator para escolher se quer importar.'
    : `Encontrei ${quantas} contas. Abra o Jurius Authenticator para escolher quais importar.`;
  pronto.classList.remove('oculto');
  $('.palco').classList.add('concluido');
}

async function laco() {
  let ultimoErro = 0;

  while (rodando && !concluido) {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      try {
        const textos = await tentarLerQr(video);
        if (textos.length > 0) { await achou(textos); return; }
      } catch (falha) {
        // Quadro ruim acontece (câmera reiniciando, aba minimizada). Só vira
        // erro visível se insistir.
        if (Date.now() - ultimoErro > 4000) ultimoErro = Date.now();
      }
    }
    // ~8 leituras por segundo: rápido para a pessoa, longe de fritar a CPU.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function iniciar(deviceId) {
  $('#erro').classList.add('oculto');
  try {
    estado('Pedindo acesso à câmera…');
    await abrirCamera(deviceId);
    await listarCameras();
    estado('Procurando um QR…');
    rodando = true;
    void laco();
  } catch (falha) {
    desligar();
    erro(mensagemDeFalha(falha));
    estado('Câmera indisponível.');
  }
}

$('#fechar').addEventListener('click', () => window.close());
$('#pronto-fechar').addEventListener('click', () => window.close());
$('#pronto-outro').addEventListener('click', () => {
  // Ler vários QR seguidos é comum quando se migra de aplicativo.
  $('#pronto').classList.add('oculto');
  $('.palco').classList.remove('concluido');
  concluido = false;
  void iniciar($('#camera').value || undefined);
});
$('#camera').addEventListener('change', (evento) => { concluido = false; void iniciar(evento.target.value); });

// A câmera não fica ligada com a janela escondida.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) desligar();
  else if (!concluido && !fluxo) void iniciar($('#camera').value || undefined);
});
window.addEventListener('pagehide', desligar);

void iniciar();
