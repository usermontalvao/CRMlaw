import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, RotateCcw, Check, AlertCircle, Video, VideoOff } from 'lucide-react';

interface FacialCaptureProps {
  onCapture: (imageData: string | null) => void;
  width?: number;
  height?: number;
  disabled?: boolean;
  label?: string;
  description?: string;
}

const FacialCapture: React.FC<FacialCaptureProps> = ({
  onCapture,
  width = 320,
  height = 240,
  disabled = false,
  label = 'Captura Facial',
  description = 'Clique em “Permitir câmera” e aguarde a solicitação do navegador',
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isStreaming, setIsStreaming] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const startCamera = useCallback(async () => {
    if (disabled) return;

    try {
      setIsLoading(true);
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setError('Seu navegador não suporta acesso à câmera (getUserMedia).');
        return;
      }

      if (!window.isSecureContext) {
        setError('Para usar a câmera, acesse o sistema via HTTPS (ou localhost).');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode: 'user',
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        setIsStreaming(true);
      }
    } catch (err: any) {
      console.error('Erro ao acessar câmera:', err);
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setError('Permissão de câmera negada/bloqueada. Clique no ícone de câmera do navegador e permita o acesso.');
      } else if (err.name === 'NotFoundError') {
        setError('Nenhuma câmera encontrada no dispositivo.');
      } else if (err.name === 'NotReadableError') {
        setError('Não foi possível acessar a câmera. Feche outros apps que estejam usando a câmera e tente novamente.');
      } else if (err.name === 'OverconstrainedError') {
        setError('Configuração de câmera não suportada neste dispositivo.');
      } else {
        setError('Erro ao acessar a câmera. Verifique permissões e se o acesso está em HTTPS.');
      }
    } finally {
      setIsLoading(false);
    }
  }, [disabled, width, height]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  }, []);

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Configurar canvas com as dimensões do vídeo
    canvas.width = video.videoWidth || width;
    canvas.height = video.videoHeight || height;

    // Desenhar frame do vídeo no canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Converter para base64
    const imageData = canvas.toDataURL('image/jpeg', 0.9);
    setCapturedImage(imageData);
    onCapture(imageData);

    // Parar a câmera após captura
    stopCamera();
  }, [width, height, onCapture, stopCamera]);

  const retakePhoto = useCallback(() => {
    setCapturedImage(null);
    onCapture(null);
    startCamera();
  }, [onCapture, startCamera]);

  // Cleanup ao desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="flex flex-col gap-3">
      {/* Label */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {label}
        </label>
        <p className="text-xs text-slate-500">{description}</p>
      </div>

      {/* Container da câmera/imagem */}
      <div
        className="relative bg-slate-900 rounded-xl overflow-hidden"
        style={{ width, height }}
      >
        {/* Vídeo da câmera */}
        {!capturedImage && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${isStreaming ? 'block' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }} // Espelhar para selfie
          />
        )}

        {/* Imagem capturada */}
        {capturedImage && (
          <img
            src={capturedImage}
            alt="Foto capturada"
            className="w-full h-full object-cover"
            style={{ transform: 'scaleX(-1)' }}
          />
        )}

        {/* Placeholder quando câmera está desligada */}
        {!isStreaming && !capturedImage && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
            <VideoOff className="w-12 h-12 mb-2" />
            <span className="text-sm">Aguardando permissão</span>
            <span className="mt-1 text-xs text-slate-500">Clique em “Permitir câmera” abaixo</span>
          </div>
        )}

        {/* Erro */}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-red-400 p-4 text-center">
            <AlertCircle className="w-10 h-10 mb-2" />
            <span className="text-xs">{error}</span>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white border-t-transparent" />
          </div>
        )}

        {/* Guia de posicionamento facial */}
        {isStreaming && !capturedImage && (
          <div className="absolute inset-0 pointer-events-none">
            {/* Oval guia */}
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border-2 border-dashed border-white/50 rounded-full"
              style={{ width: '60%', height: '80%' }}
            />
            {/* Texto guia */}
            <div className="absolute bottom-4 left-0 right-0 text-center">
              <span className="text-white text-xs bg-black/50 px-3 py-1 rounded-full">
                Posicione seu rosto no oval
              </span>
            </div>
          </div>
        )}

        {/* Indicador de foto capturada */}
        {capturedImage && (
          <div className="absolute top-3 right-3 bg-emerald-500 text-white rounded-full p-1.5">
            <Check className="w-4 h-4" />
          </div>
        )}
      </div>

      {/* Canvas oculto para captura */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Botões de ação */}
      <div className="flex gap-2">
        {!isStreaming && !capturedImage && (
          <button
            type="button"
            onClick={startCamera}
            disabled={disabled || isLoading}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Video className="w-4 h-4" />
            Permitir câmera
          </button>
        )}

        {isStreaming && !capturedImage && (
          <>
            <button
              type="button"
              onClick={capturePhoto}
              disabled={disabled}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Camera className="w-4 h-4" />
              Capturar Foto
            </button>
            <button
              type="button"
              onClick={stopCamera}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <VideoOff className="w-4 h-4" />
              Desligar
            </button>
          </>
        )}

        {capturedImage && (
          <button
            type="button"
            onClick={retakePhoto}
            disabled={disabled}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="w-4 h-4" />
            Tirar Outra Foto
          </button>
        )}
      </div>
    </div>
  );
};

export default FacialCapture;
