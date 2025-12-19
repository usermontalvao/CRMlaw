import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser, RotateCcw, Check } from 'lucide-react';

interface SignatureCanvasProps {
  onSignatureChange: (signatureData: string | null) => void;
  width?: number;
  height?: number;
  lineColor?: string;
  lineWidth?: number;
  backgroundColor?: string;
  disabled?: boolean;
  responsive?: boolean;
}

const SignatureCanvas: React.FC<SignatureCanvasProps> = ({
  onSignatureChange,
  width = 500,
  height = 200,
  lineColor = '#1e293b',
  lineWidth = 2,
  backgroundColor = '#ffffff',
  disabled = false,
  responsive = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number; height: number }>({ width, height });

  const updateResponsiveSize = useCallback(() => {
    if (!responsive) {
      setCanvasDimensions({ width, height });
      return;
    }

    const containerWidth = containerRef.current?.clientWidth || width;
    const clampedWidth = Math.max(280, Math.min(640, containerWidth));
    const aspectRatio = height / width || 0.4;
    const targetHeight = Math.max(140, Math.round(clampedWidth * aspectRatio));
    setCanvasDimensions({ width: clampedWidth, height: targetHeight });
  }, [responsive, width, height]);

  useEffect(() => {
    updateResponsiveSize();
    if (!responsive) return;

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => updateResponsiveSize());
      if (containerRef.current) observer.observe(containerRef.current);
      return () => observer.disconnect();
    }

    const handleResize = () => updateResponsiveSize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [responsive, updateResponsiveSize]);

  const getContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext('2d');
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    // Limpar com transparência em vez de fundo branco
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSignatureChange(null);
  }, [getContext, onSignatureChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = getContext();
    if (!canvas || !ctx) return;

    // Configurar canvas para alta resolução
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasDimensions.width * dpr;
    canvas.height = canvasDimensions.height * dpr;
    canvas.style.width = `${canvasDimensions.width}px`;
    canvas.style.height = `${canvasDimensions.height}px`;
    ctx.scale(dpr, dpr);

    // Configurar estilo de desenho
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;

    // Não preencher fundo - manter transparente para PNG
  }, [canvasDimensions.width, canvasDimensions.height, lineColor, lineWidth, backgroundColor, getContext]);

  const getCoordinates = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      const touch = e.touches[0];
      if (!touch) return null;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (disabled) return;
    e.preventDefault();

    const coords = getCoordinates(e);
    if (!coords) return;

    setIsDrawing(true);
    lastPointRef.current = coords;
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ) => {
    if (!isDrawing || disabled) return;
    e.preventDefault();

    const ctx = getContext();
    const coords = getCoordinates(e);
    if (!ctx || !coords || !lastPointRef.current) return;

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.stroke();

    lastPointRef.current = coords;
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (isDrawing && hasSignature) {
      const canvas = canvasRef.current;
      if (canvas) {
        const signatureData = canvas.toDataURL('image/png');
        onSignatureChange(signatureData);
      }
    }
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full" ref={containerRef}>
        <canvas
          ref={canvasRef}
          className={`border-2 border-dashed rounded-xl cursor-crosshair touch-none ${
            disabled
              ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
              : 'border-slate-300 hover:border-slate-400'
          }`}
          style={{ width: canvasDimensions.width, height: canvasDimensions.height }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {/* Linha guia */}
        <div
          className="absolute left-4 right-4 border-b border-slate-300 pointer-events-none"
          style={{ bottom: '30%' }}
        />

        {/* Texto guia */}
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-slate-400 text-sm">
              Assine aqui
            </span>
          </div>
        )}

        {/* Indicador de assinatura válida */}
        {hasSignature && (
          <div className="absolute top-2 right-2 bg-emerald-500 text-white rounded-full p-1">
            <Check className="w-3 h-3" />
          </div>
        )}
      </div>

      {/* Botões de ação */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={clearCanvas}
          disabled={disabled || !hasSignature}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Limpar
        </button>
        <button
          type="button"
          onClick={clearCanvas}
          disabled={disabled || !hasSignature}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Eraser className="w-3.5 h-3.5" />
          Apagar Tudo
        </button>
      </div>
    </div>
  );
};

export default SignatureCanvas;
