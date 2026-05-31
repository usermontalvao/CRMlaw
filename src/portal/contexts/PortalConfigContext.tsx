/**
 * PortalConfigContext — lê do banco quais módulos estão habilitados.
 * Consumido pelo Sidebar e pelo Router para esconder rotas desativadas.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { clientPortalService } from '../services/clientPortal.service';

interface PortalConfig {
  processos:    boolean;
  documentos:   boolean;
  assinar:      boolean;
  financeiro:   boolean;
  agenda:       boolean;
  mensagens:    boolean;
  notificacoes: boolean;
  perfil:       boolean;
}

const DEFAULT: PortalConfig = {
  processos: true, documentos: true, assinar: true,
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

  const isEnabled = (module: keyof PortalConfig) => config[module] !== false;

  return (
    <Ctx.Provider value={{ config, loading, isEnabled }}>
      {children}
    </Ctx.Provider>
  );
};

export const usePortalConfig = () => useContext(Ctx);
