import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { profileService, ThemePreference } from '../services/profile.service';

interface ThemeContextType {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>('light');
  const { user } = useAuth();

  // Carregar preferência salva no localStorage ou sistema ao iniciar
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as ThemePreference;
    if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
      setThemeState(savedTheme);
    } else {
      // Padrão light se não houver preferência salva
      setThemeState('light');
    }
  }, []);

  // Sincronizar com perfil do usuário quando logar
  useEffect(() => {
    if (user) {
      profileService.getProfile(user.id).then((profile) => {
        if (profile?.theme_preference) {
          setThemeState(profile.theme_preference);
          localStorage.setItem('theme', profile.theme_preference);
        }
      }).catch(console.error);
    }
  }, [user]);

  // Aplicar tema no DOM
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const setTheme = async (newTheme: ThemePreference) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);

    // Salvar no banco apenas se usuário logado (falha silenciosa se coluna não existir)
    if (user) {
      try {
        await profileService.updateThemePreference(user.id, newTheme);
      } catch (error) {
        // Ignora erro - coluna pode não existir ainda no banco
        console.warn('Tema salvo apenas localmente:', error);
      }
    }
  };

  const toggleTheme = async () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    await setTheme(newTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
