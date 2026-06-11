import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { profileService, type SidebarMode } from '../services/profile.service';

interface SidebarModeContextType {
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => Promise<void>;
}

const SidebarModeContext = createContext<SidebarModeContextType | undefined>(undefined);

export function SidebarModeProvider({ children }: { children: React.ReactNode }) {
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>('normal');
  const { user } = useAuth();

  // Fast fallback from localStorage while Supabase loads
  useEffect(() => {
    const saved = localStorage.getItem('sidebar_mode') as SidebarMode;
    if (saved === 'compact' || saved === 'normal') {
      setSidebarModeState(saved);
    }
  }, []);

  // Sync from Supabase when user is available (source of truth)
  useEffect(() => {
    if (user) {
      profileService.getProfile(user.id).then((profile) => {
        if (profile?.sidebar_mode) {
          setSidebarModeState(profile.sidebar_mode);
          localStorage.setItem('sidebar_mode', profile.sidebar_mode);
        }
      }).catch(console.error);
    }
  }, [user]);

  const setSidebarMode = async (mode: SidebarMode) => {
    setSidebarModeState(mode);
    localStorage.setItem('sidebar_mode', mode);

    if (user) {
      try {
        await profileService.updateSidebarMode(user.id, mode);
      } catch (error) {
        console.warn('sidebar_mode salvo apenas localmente:', error);
      }
    }
  };

  return (
    <SidebarModeContext.Provider value={{ sidebarMode, setSidebarMode }}>
      {children}
    </SidebarModeContext.Provider>
  );
}

export function useSidebarMode() {
  const context = useContext(SidebarModeContext);
  if (context === undefined) {
    throw new Error('useSidebarMode must be used within a SidebarModeProvider');
  }
  return context;
}
