/**
 * PortalConfigContext — lê do banco quais módulos estão habilitados.
 * Consumido pelo Sidebar e pelo Router para esconder rotas desativadas.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { clientPortalService } from '../services/clientPortal.service';

interface PortalConfig {
  casos:        boolean;  // Unifica processos + requerimentos
  processos:    boolean;  // Alias legado — controla o mesmo módulo
  scanner:      boolean;
  documentos:   boolean;
  assinar:      boolean;
  financeiro:   boolean;
  agenda:       boolean;
  mensagens:    boolean;
  notificacoes: boolean;
  perfil:       boolean;
}

const DEFAULT: PortalConfig = {
  casos: true, processos: true, scanner: true, documentos: true, assinar: true,
  financeiro: true, agenda: true, mensagens: true,
  notificacoes: true, perfil: true,
};

interface PortalConfigCtx {
  config: PortalConfig;
  loading: boolean;
  isEnabled: (module: keyof PortalConfig) => boolean;
}

const Ctx = createContext<PortalConfigCtx>({
  config: DEFAULT,
  loading: true,
  isEnabled: () => true,
});

export const PortalConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<PortalConfig>(DEFAULT);
  const [loading, setLoading] = useState(true);

  const load = () => {
    clientPortalService.getModulesConfig()
      .then((data) => setConfig({ ...DEFAULT, ...data }))
      .catch(() => setConfig(DEFAULT))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const isEnabled = (module: keyof PortalConfig) => {
    // 'casos' é habilitado se 'processos' estiver habilitado (mesma configuração)
    if (module === 'casos') return config.processos !== false;
    return config[module] !== false;
  };

  return (
    <Ctx.Provider value={{ config, loading, isEnabled }}>
      {children}
    </Ctx.Provider>
  );
};

export const usePortalConfig = () => useContext(Ctx);
