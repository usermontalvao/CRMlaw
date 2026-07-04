import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { profileService, type PetitionEditorThemePreference } from '../services/profile.service';

const STORAGE_KEY = 'petition-editor-dark-mode-v1';

const toBoolean = (value: PetitionEditorThemePreference | null | undefined) => value === 'dark';

export function usePetitionEditorTheme() {
  const { user } = useAuth();
  const [darkMode, setDarkModeState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    profileService
      .getMyPetitionEditorThemePreference()
      .then((preference) => {
        if (cancelled || !preference) return;
        const next = toBoolean(preference);
        setDarkModeState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    try {
      document.body.classList.toggle('petition-dark', darkMode);
      window.localStorage.setItem(STORAGE_KEY, darkMode ? '1' : '0');
    } catch {
      // ignore
    }

    return () => {
      try {
        document.body.classList.remove('petition-dark');
      } catch {
        // ignore
      }
    };
  }, [darkMode]);

  const setDarkMode = useCallback(
    async (next: boolean) => {
      setDarkModeState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }

      if (!user) return;
      try {
        await profileService.updateMyPetitionEditorThemePreference(next ? 'dark' : 'light');
      } catch {
        // ignore
      }
    },
    [user],
  );

  const toggleDarkMode = useCallback(async () => {
    await setDarkMode(!darkMode);
  }, [darkMode, setDarkMode]);

  return {
    darkMode,
    setDarkMode,
    toggleDarkMode,
  };
}
