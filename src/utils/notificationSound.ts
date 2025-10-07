// Sistema de sons para notificações

export type NotificationSoundType = 'default' | 'urgent' | 'success' | 'info';

class NotificationSoundService {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;

  constructor() {
    // Verifica se o áudio está habilitado nas preferências
    const savedPreference = localStorage.getItem('notifications_sound_enabled');
    this.enabled = savedPreference !== 'false';
  }

  /**
   * Inicializa o AudioContext (necessário para iOS)
   */
  private initAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.audioContext;
  }

  /**
   * Toca um som de notificação padrão usando Web Audio API
   */
  private playTone(frequency: number, duration: number, volume: number = 0.3) {
    if (!this.enabled) return;

    try {
      const context = this.initAudioContext();
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(context.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(volume, context.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + duration);

      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + duration);
    } catch (error) {
      console.error('Erro ao tocar som:', error);
    }
  }

  /**
   * Toca som de notificação padrão (dois tons)
   */
  playDefault() {
    this.playTone(800, 0.1, 0.2);
    setTimeout(() => this.playTone(1000, 0.1, 0.2), 100);
  }

  /**
   * Toca som de notificação urgente (três tons rápidos)
   */
  playUrgent() {
    this.playTone(1200, 0.08, 0.3);
    setTimeout(() => this.playTone(1200, 0.08, 0.3), 100);
    setTimeout(() => this.playTone(1400, 0.12, 0.3), 200);
  }

  /**
   * Toca som de sucesso (tom ascendente)
   */
  playSuccess() {
    this.playTone(600, 0.1, 0.2);
    setTimeout(() => this.playTone(800, 0.1, 0.2), 80);
    setTimeout(() => this.playTone(1000, 0.15, 0.2), 160);
  }

  /**
   * Toca som informativo (tom único suave)
   */
  playInfo() {
    this.playTone(700, 0.15, 0.15);
  }

  /**
   * Toca som baseado no tipo
   */
  play(type: NotificationSoundType = 'default') {
    if (!this.enabled) return;

    switch (type) {
      case 'urgent':
        this.playUrgent();
        break;
      case 'success':
        this.playSuccess();
        break;
      case 'info':
        this.playInfo();
        break;
      default:
        this.playDefault();
    }
  }

  /**
   * Habilita sons de notificação
   */
  enable() {
    this.enabled = true;
    localStorage.setItem('notifications_sound_enabled', 'true');
  }

  /**
   * Desabilita sons de notificação
   */
  disable() {
    this.enabled = false;
    localStorage.setItem('notifications_sound_enabled', 'false');
  }

  /**
   * Verifica se os sons estão habilitados
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Testa o som
   */
  test() {
    this.playDefault();
  }
}

export const notificationSound = new NotificationSoundService();
