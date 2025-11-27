import React from 'react';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const SessionWarning: React.FC = () => {
  const { sessionWarning, extendSession, signOut } = useAuth();

  if (!sessionWarning) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] max-w-sm">
      <div className="bg-amber-50 border border-amber-200 rounded-lg shadow-lg p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-amber-800">
              Sessão Expirando
            </h3>
            <p className="text-sm text-amber-700 mt-1">
              Sua sessão expirará em 5 minutos por inatividade.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={extendSession}
                className="inline-flex items-center gap-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
              >
                <Clock className="w-3 h-3" />
                Continuar Logado
              </button>
              <button
                onClick={signOut}
                className="text-xs text-amber-700 hover:text-amber-800 font-medium"
              >
                Fazer Logout
              </button>
            </div>
          </div>
          <button
            onClick={extendSession}
            className="flex-shrink-0 text-amber-500 hover:text-amber-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionWarning;
