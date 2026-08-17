// Conversão PCM entre o formato do navegador e o do WaCalls.
//
// O WaCalls NÃO trafega áudio como track de mídia do WebRTC: o servidor Go
// espera receber, e devolve, quadros de PCM 16 bits little-endian a 16 kHz por
// um DataChannel. Estas duas funções são exatamente as do cliente oficial
// (`client/src/lib/pcm.ts` do repositório JotaDev66/WaCalls) — portadas, não
// reinventadas, porque qualquer diferença de escala ou de ordem de bytes vira
// ruído branco do outro lado da linha.
//
// Sem imports de propósito: é o módulo que os testes carregam.

/** Float32 [-1, 1] do AudioWorklet → Int16 little-endian para o DataChannel. */
export const float32ToInt16LE = (pcm: Float32Array): ArrayBuffer => {
  const view = new DataView(new ArrayBuffer(pcm.length * 2));
  for (let i = 0; i < pcm.length; i += 1) {
    let s = pcm[i];
    if (Number.isNaN(s)) s = 0;
    else if (s > 1) s = 1;
    else if (s < -1) s = -1;
    // A escala é assimétrica (32768 no negativo, 32767 no positivo) porque é
    // assim que o inteiro de 16 bits com sinal se distribui — usar 32767 nos
    // dois lados corta o pico negativo.
    view.setInt16(i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return view.buffer;
};

/** Int16 little-endian recebido do WaCalls → Float32 [-1, 1] para o playback. */
export const int16LEToFloat32 = (buf: ArrayBuffer): Float32Array => {
  const view = new DataView(buf);
  const n = Math.floor(buf.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
};
