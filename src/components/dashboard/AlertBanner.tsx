import React from 'react';
import { AlertTriangle, ChevronRight } from 'lucide-react';

interface Alert {
  type: string;
  count: number;
  action: string;
}

interface AlertBannerProps {
  alerts: Alert[];
  onNavigate: (action: string) => void;
}

export const AlertBanner: React.FC<AlertBannerProps> = ({ alerts, onNavigate }) => {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 p-3 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl shadow-md">
      <div className="flex items-center gap-2 text-white">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm font-semibold">Atenção:</span>
      </div>
      {alerts.map((alert, index) => (
        <button
          key={index}
          onClick={() => onNavigate(alert.action)}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 transition-all group"
        >
          <span className="text-white text-xs font-medium">{alert.type}</span>
          <span className="bg-white text-red-600 text-xs font-bold px-1.5 py-0.5 rounded-full">
            {alert.count}
          </span>
        </button>
      ))}
    </div>
  );
};

export default AlertBanner;
