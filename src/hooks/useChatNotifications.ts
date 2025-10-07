// src/hooks/useChatNotifications.ts
import { useCallback, useEffect, useRef, useState } from "react";

type NotifyArgs = {
  title?: string;
  body?: string;
  icon?: string;
  tag?: string;
  requireInteraction?: boolean;
  data?: unknown;
  silent?: boolean;
  vibrate?: number[];
};

type Options = {
  soundUrl?: string;
  volume?: number;
  icon?: string;
  vibrate?: number[];
  requireInteraction?: boolean;
};

export const useChatNotifications = (opts: Options = {}) => {
  const {
    soundUrl = "/sounds/incoming.mp3",
    volume = 0.6,
    icon,
    vibrate,
    requireInteraction,
  } = opts;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const el = new Audio(soundUrl);
    el.preload = "auto";
    el.volume = volume;
    audioRef.current = el;
    return () => {
      audioRef.current = null;
    };
  }, [soundUrl, volume]);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPermission(Notification.permission);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return false;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      return p === "granted";
    } catch {
      return false;
    }
  }, []);

  const playSound = useCallback(async () => {
    if (muted) return;
    try {
      await audioRef.current?.play();
    } catch {
      /* ignore autoplay fail */
    }
  }, [muted]);

  const notify = useCallback(
    (args: NotifyArgs = {}) => {
      if (typeof Notification === "undefined") return null;
      if (permission !== "granted") return null;

      const n = new Notification(args.title ?? "Nova mensagem", {
        body: args.body,
        icon: args.icon ?? icon,
        tag: args.tag,
        requireInteraction:
          args.requireInteraction ?? requireInteraction ?? false,
        silent: args.silent ?? false,
        vibrate: args.vibrate ?? vibrate,
        data: args.data,
      });

      n.onclick = () => {
        window.focus?.();
        n.close();
      };

      return n;
    },
    [permission, icon, vibrate, requireInteraction]
  );

  const ping = useCallback(
    (args: Omit<NotifyArgs, "title"> & { title?: string } = {}) => {
      playSound();
      if (document.hidden) {
        notify(args);
      }
    },
    [notify, playSound]
  );

  return {
    requestPermission,
    playSound,
    notify,
    ping,
    permission,
    muted,
    setMuted,
    canNotify:
      typeof Notification !== "undefined" && permission === "granted",
    supported: typeof Notification !== "undefined",
  };
};
