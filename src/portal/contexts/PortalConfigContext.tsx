/**
 * PortalConfigContext — lê do banco quais módulos estão habilitados
 * e a personalização visual do portal (cor, mensagem, rodapé).
 * Consumido pelo Sidebar, Layout e Router.
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

export interface PortalCustomization {
  accent_color:    string;
  welcome_message: string;
  footer_text:     string;
  support_contact: string;
}

const DEFAULT: PortalConfig = {
  casos: true, processos: true, scanner: true, documentos: true, assinar: true,
  financeiro: true, agenda: true, mensagens: true,
  notificacoes: true, perfil: true,
};

const CUSTOM_DEFAULTS: PortalCustomization = {
  accent_color:    '#ff8a00',
  welcome_message: 'Bem-vindo ao Portal do Cliente',
  footer_text:     '',
  support_contact: '',
};

interface PortalConfigCtx {
  config:        PortalConfig;
  customization: PortalCustomization;
  loading:       boolean;
  isEnabled: (module: keyof PortalConfig) => boolean;
}

const Ctx = createContext<PortalConfigCtx>({
  config:        DEFAULT,
  customization: CUSTOM_DEFAULTS,
  loading:       true,
  isEnabled:     () => true,
});

export const PortalConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig]             = useState<PortalConfig>(DEFAULT);
  const [customization, setCustomization] = useState<PortalCustomization>(CUSTOM_DEFAULTS);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    Promise.all([
      clientPortalService.getModulesConfig(),
      clientPortalService.getCustomizationConfig(),
    ])
      .then(([modules, custom]) => {
        setConfig({ ...DEFAULT, ...modules });
        setCustomization(custom);
        // Injeta CSS var para que PortalLayout/Sidebar possam usar via style
        document.documentElement.style.setProperty('--portal-accent', custom.accent_color);
      })
      .catch(() => {
        setConfig(DEFAULT);
      })
      .finally(() => setLoading(false));
  }, []);

  const isEnabled = (module: keyof PortalConfig) => {
    if (module === 'casos') return config.processos !== false;
    return config[module] !== false;
  };

  return (
    <Ctx.Provider value={{ config, customization, loading, isEnabled }}>
      {children}
    </Ctx.Provider>
  );
};

export const usePortalConfig = () => useContext(Ctx);
