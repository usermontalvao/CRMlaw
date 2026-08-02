import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

/**
 * Confete em <canvas> com física própria (gravidade, arrasto, rotação 3D
 * simulada). Em DOM puro, algumas centenas de partículas derrubam o frame
 * rate; aqui tudo é desenhado num único elemento.
 */

export type ConfettiHandle = {
  burst: (options?: { x?: number; y?: number; count?: number; power?: number; spread?: number }) => void;
  /** Chuva contínua e suave, usada no encerramento. */
  setRain: (enabled: boolean) => void;
  clear: () => void;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rotation: number;
  spin: number;
  wobble: number;
  wobbleSpeed: number;
  color: string;
  shape: 'rect' | 'circle' | 'ribbon';
  life: number;
  maxLife: number;
};

const PALETTE = [
  '#fbbf24',
  '#f97316',
  '#fb7185',
  '#e879f9',
  '#a78bfa',
  '#60a5fa',
  '#34d399',
  '#fde68a',
  '#ffffff',
];

const MAX_PARTICLES = 900;

const random = (min: number, max: number) => min + Math.random() * (max - min);

const ConfettiCanvas = forwardRef<ConfettiHandle, { className?: string }>(function ConfettiCanvas(
  { className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rainRef = useRef(false);
  const rainAccumulatorRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });

  const spawn = (particle: Particle) => {
    const particles = particlesRef.current;
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(particle);
  };

  const makeParticle = (x: number, y: number, vx: number, vy: number): Particle => {
    const shapes: Particle['shape'][] = ['rect', 'rect', 'circle', 'ribbon'];
    const maxLife = random(2.6, 5.4);
    return {
      x,
      y,
      vx,
      vy,
      w: random(6, 13),
      h: random(9, 18),
      rotation: random(0, Math.PI * 2),
      spin: random(-9, 9),
      wobble: random(0, Math.PI * 2),
      wobbleSpeed: random(4, 9),
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      life: 0,
      maxLife,
    };
  };

  useImperativeHandle(ref, () => ({
    burst: ({ x, y, count = 160, power = 1, spread = Math.PI * 2 } = {}) => {
      const { width, height } = sizeRef.current;
      if (!width || !height) return;
      const originX = x ?? width / 2;
      const originY = y ?? height * 0.42;

      for (let i = 0; i < count; i += 1) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
        const speed = random(320, 980) * power;
        spawn(
          makeParticle(
            originX + random(-18, 18),
            originY + random(-18, 18),
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
          ),
        );
      }
    },
    setRain: (enabled: boolean) => {
      rainRef.current = enabled;
    },
    clear: () => {
      particlesRef.current = [];
      rainRef.current = false;
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let previous = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      sizeRef.current = { width, height };
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;

      const { width, height } = sizeRef.current;
      context.clearRect(0, 0, width, height);

      if (rainRef.current && width) {
        rainAccumulatorRef.current += delta * 34;
        while (rainAccumulatorRef.current >= 1) {
          rainAccumulatorRef.current -= 1;
          spawn(makeParticle(random(0, width), -20, random(-40, 40), random(60, 150)));
        }
      }

      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.life += delta;

        particle.vy += 900 * delta; // gravidade
        particle.vx *= 1 - 1.6 * delta; // arrasto
        particle.vy *= 1 - 0.9 * delta;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.rotation += particle.spin * delta;
        particle.wobble += particle.wobbleSpeed * delta;

        if (particle.life > particle.maxLife || particle.y > height + 60) {
          particles.splice(i, 1);
          continue;
        }

        const fade = Math.min(1, (particle.maxLife - particle.life) / 0.9);
        context.save();
        context.globalAlpha = Math.max(0, fade);
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        // O cosseno simula a folha girando no eixo próprio (efeito "papel").
        context.scale(1, Math.cos(particle.wobble));
        context.fillStyle = particle.color;

        if (particle.shape === 'circle') {
          context.beginPath();
          context.arc(0, 0, particle.w / 2, 0, Math.PI * 2);
          context.fill();
        } else if (particle.shape === 'ribbon') {
          context.fillRect(-particle.w / 4, -particle.h, particle.w / 2, particle.h * 2);
        } else {
          context.fillRect(-particle.w / 2, -particle.h / 2, particle.w, particle.h);
        }
        context.restore();
      }
    };

    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
});

export default ConfettiCanvas;
