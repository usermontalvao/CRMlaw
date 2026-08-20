// O painel que escolhe o microfone e o alto-falante das ligações.
//
// Mora no MÓDULO, não em Configurações, e de propósito: driver de áudio é coisa
// que se descobre errada no meio de uma ligação ("estou ouvindo pelo monitor"),
// e nesse momento sair da conversa para procurar uma tela de ajustes é o mesmo
// que desistir. Por isso há dois caminhos para o MESMO painel — o fone no
// cabeçalho da inbox e o atalho na barra do widget da chamada.
//
// A escolha é gravada no navegador (ver `utils/audioDevices`) e vale para as
// três famílias de som do CRM: a ligação, o toque da chamada recebida e os
// avisos de mensagem.
import React, { useCallback, useEffect, useState } from 'react';
import { Headphones, PlayCircle, Volume2 } from 'lucide-react';
import {
  getPreferredInputId, getPreferredOutputId, listAudioDevices, microphoneConstraints,
  onAudioDeviceChange, revealDeviceLabels, setPreferredInputId, setPreferredOutputId,
  supportsOutputSelection, type AudioDeviceList,
} from '../../utils/audioDevices';
import { playRingTest } from '../../services/wacalls/ringtone';
import { WaDialog, WaDialogBody, WaField, WaFieldStack, waBtnGhost, waSelect, waSelectStyle } from './ui';
import { LAYER } from '../../styles/layers';

const LISTA_VAZIA: AudioDeviceList = { inputs: [], outputs: [], labelsHidden: false };

/** Acima do widget da chamada — o painel é aberto POR ele. */
const Z_ACIMA_DA_CHAMADA = LAYER.CALL_NESTED;

/**
 * O medidor do microfone.
 *
 * Sem ele, escolher entre "Headset" e "Microfone da webcam" é adivinhação: os
 * dois existem, os dois parecem certos, e a única prova de qual está captando é
 * ver a barra andar quando se fala. Abre o microfone só enquanto o painel está
 * aberto e o fecha ao trocar de dispositivo.
 */
function useMicLevel(deviceId: string | null, ativo: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!ativo || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    let cancelado = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let frame = 0;

    const parar = () => {
      cancelado = true;
      if (frame) cancelAnimationFrame(frame);
      try { stream?.getTracks().forEach(t => t.stop()); } catch { /* já parado */ }
      try { void context?.close(); } catch { /* idem */ }
    };

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: microphoneConstraints() });
      } catch {
        // Sem permissão ou dispositivo fora: a barra fica parada e o painel já
        // mostra o aviso de permissão logo acima.
        return;
      }
      if (cancelado) { stream.getTracks().forEach(t => t.stop()); return; }

      // Contexto PRÓPRIO, e não o compartilhado: este é criado e destruído a
      // cada abertura do painel, e fechar o compartilhado calaria o CRM inteiro.
      const AC = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      context = new AC();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);

      const medir = () => {
        if (cancelado) return;
        analyser.getFloatTimeDomainData(buffer);
        let soma = 0;
        for (const amostra of buffer) soma += amostra * amostra;
        const rms = Math.sqrt(soma / buffer.length);
        // A queda é mais lenta que a subida: um medidor que zera entre sílabas
        // pisca e não dá para ler.
        setLevel(anterior => Math.max(Math.min(1, rms * 6), anterior * 0.82));
        frame = requestAnimationFrame(medir);
      };
      frame = requestAnimationFrame(medir);
    })();

    return parar;
  }, [deviceId, ativo]);

  return ativo ? level : 0;
}

/** O conteúdo do painel. Exportado à parte para poder ser usado em outro lugar. */
export const WaAudioDeviceForm: React.FC = () => {
  const [devices, setDevices] = useState<AudioDeviceList>(LISTA_VAZIA);
  const [input, setInput] = useState<string>(() => getPreferredInputId() ?? 'default');
  const [output, setOutput] = useState<string>(() => getPreferredOutputId() ?? 'default');
  const [aviso, setAviso] = useState<string | null>(null);
  const podeEscolherSaida = supportsOutputSelection();
  const level = useMicLevel(input, true);

  const recarregar = useCallback(async () => {
    setDevices(await listAudioDevices());
  }, []);

  useEffect(() => {
    void recarregar();
    // Plugar o headset com o painel aberto é o caso mais comum de todos —
    // a lista tem de se atualizar sozinha.
    const md = navigator.mediaDevices;
    md?.addEventListener?.('devicechange', recarregar);
    const solta = onAudioDeviceChange(() => {
      setInput(getPreferredInputId() ?? 'default');
      setOutput(getPreferredOutputId() ?? 'default');
    });
    return () => { md?.removeEventListener?.('devicechange', recarregar); solta(); };
  }, [recarregar]);

  const liberarNomes = async () => {
    const ok = await revealDeviceLabels();
    if (!ok) setAviso('O navegador negou o microfone. Libere-o no cadeado da barra de endereço e tente de novo.');
    else setAviso(null);
    await recarregar();
  };

  const testarSaida = () => {
    // O toque REAL da chamada recebida, no alto-falante escolhido: é o que a
    // pessoa precisa reconhecer quando o telefone tocar de verdade.
    if (playRingTest()) { setAviso(null); return; }
    setAviso('O navegador ainda não liberou o áudio nesta aba. Clique em qualquer lugar da tela e teste de novo.');
  };

  /** Preferência apontando para um aparelho que não está mais plugado. */
  const desconectado = (opcoes: { deviceId: string }[], escolhido: string) =>
    escolhido !== 'default' && !opcoes.some(o => o.deviceId === escolhido);

  const inputSumiu = desconectado(devices.inputs, input);
  const outputSumiu = desconectado(devices.outputs, output);

  return (
    <WaFieldStack>
      {devices.labelsHidden && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-[12.5px] leading-snug text-amber-800">
            O navegador esconde o nome dos dispositivos até o microfone ser liberado.
          </p>
          <button type="button" onClick={liberarNomes}
            className="mt-2 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-amber-700">
            Liberar e mostrar os nomes
          </button>
        </div>
      )}

      <WaField label="Microfone" hint="Usado nas ligações de voz.">
        <select className={waSelect} style={waSelectStyle} value={input}
          onChange={(e) => { setInput(e.target.value); setPreferredInputId(e.target.value); }}>
          <option value="default">Padrão do sistema</option>
          {devices.inputs
            .filter(d => d.deviceId !== 'default')
            .map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
          {inputSumiu && <option value={input}>Dispositivo salvo (desconectado)</option>}
        </select>
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#f3f2ef]">
            <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
              style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
          <span className="text-[11px] text-slate-400">fale para testar</span>
        </div>
        {inputSumiu && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-amber-700">
            O microfone escolhido não está conectado. As ligações usam o padrão do sistema até ele voltar.
          </p>
        )}
      </WaField>

      <WaField label="Alto-falante"
        hint={podeEscolherSaida
          ? 'Vale para a voz do cliente, o toque da chamada e os avisos de mensagem.'
          : undefined}>
        {podeEscolherSaida ? (<>
          <select className={waSelect} style={waSelectStyle} value={output}
            onChange={(e) => { setOutput(e.target.value); setPreferredOutputId(e.target.value); }}>
            <option value="default">Padrão do sistema</option>
            {devices.outputs
              .filter(d => d.deviceId !== 'default')
              .map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
            {outputSumiu && <option value={output}>Dispositivo salvo (desconectado)</option>}
          </select>
          <button type="button" onClick={testarSaida} className={`${waBtnGhost} mt-2 w-full`}>
            <PlayCircle size={15} /> Tocar um teste
          </button>
          {outputSumiu && (
            <p className="mt-1.5 text-[11.5px] leading-snug text-amber-700">
              O alto-falante escolhido não está conectado. O som sai no padrão do sistema até ele voltar.
            </p>
          )}
        </>) : (
          <p className="rounded-xl border border-[#e7e5df] bg-[#faf9f7] px-3 py-2.5 text-[12.5px] leading-snug text-slate-500">
            Este navegador não deixa escolher a saída de áudio — o som sai sempre no dispositivo padrão do
            sistema. No Chrome ou no Edge a escolha fica disponível.
          </p>
        )}
      </WaField>

      {aviso && <p className="text-[12px] leading-snug text-amber-700">{aviso}</p>}

      <p className="text-[11.5px] leading-snug text-slate-400">
        A escolha fica salva neste computador — não é preciso refazer a cada entrada. Em outra máquina,
        escolha de novo: os dispositivos são outros.
      </p>
    </WaFieldStack>
  );
};

/**
 * O fone que abre o painel. Um só componente para os dois lugares — o cabeçalho
 * da inbox e a barra do widget da chamada — porque é o MESMO painel.
 */
export const WaAudioDeviceButton: React.FC<{
  className?: string;
  size?: number;
  /** Aberto de dentro do widget da chamada: o diálogo precisa passar por cima dele. */
  sobreAChamada?: boolean;
}> = ({ className = '', size = 15, sobreAChamada = false }) => {
  const [open, setOpen] = useState(false);
  return (<>
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      title="Microfone e alto-falante das ligações"
      aria-label="Microfone e alto-falante das ligações"
      className={className || 'flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 transition-colors hover:bg-[#f1f0ec] hover:text-slate-700'}
    >
      <Headphones size={size} />
    </button>
    {open && (
      <WaDialog
        title="Dispositivos de áudio"
        subtitle="Vale para as ligações, o toque da chamada e os avisos. Fica salvo neste computador."
        icon={<Volume2 size={18} />}
        size="sm"
        zIndex={sobreAChamada ? Z_ACIMA_DA_CHAMADA : LAYER.MODAL}
        onClose={() => setOpen(false)}
      >
        <WaDialogBody>
          <WaAudioDeviceForm />
        </WaDialogBody>
      </WaDialog>
    )}
  </>);
};
