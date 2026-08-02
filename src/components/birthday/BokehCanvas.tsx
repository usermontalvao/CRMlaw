import { useEffect, useRef } from 'react';

/**
 * Poeira luminosa flutuando ao fundo. Em <canvas> porque são ~70 partículas
 * com brilho radial — em DOM, isso vira 70 elementos com blur e derruba o
 * frame rate justamente no celular.
 */

type Orb = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  phase: number;
  hue: number;
  alpha: number;
};

const HUES = [38, 28, 345, 275, 200];

export default function BokehCanvas({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let orbs: Orb[] = [];

    const build = () => {
      // Menos partículas em tela pequena: o custo é por pixel preenchido.
      const count = Math.round(Math.min(70, Math.max(24, (width * height) / 22000)));
      orbs = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: 1.5 + Math.random() * 5.5,
        speed: 6 + Math.random() * 16,
        drift: 8 + Math.random() * 20,
        phase: Math.random() * Math.PI * 2,
        hue: HUES[Math.floor(Math.random() * HUES.length)],
        alpha: 0.12 + Math.random() * 0.3,
      }));
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    let previous = performance.now();

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;

      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      for (const orb of orbs) {
        if (!reduceMotion) {
          orb.y -= orb.speed * delta;
          orb.phase += delta * 0.6;
          if (orb.y < -orb.radius * 4) {
            orb.y = height + orb.radius * 4;
            orb.x = Math.random() * width;
          }
        }

        const x = orb.x + Math.sin(orb.phase) * orb.drift;
        const twinkle = 0.65 + 0.35 * Math.sin(orb.phase * 1.7);
        const glow = context.createRadialGradient(x, orb.y, 0, x, orb.y, orb.radius * 4);
        glow.addColorStop(0, `hsla(${orb.hue}, 95%, 78%, ${orb.alpha * twinkle})`);
        glow.addColorStop(1, `hsla(${orb.hue}, 95%, 70%, 0)`);

        context.fillStyle = glow;
        context.beginPath();
        context.arc(x, orb.y, orb.radius * 4, 0, Math.PI * 2);
        context.fill();
      }

      context.globalCompositeOperation = 'source-over';
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
