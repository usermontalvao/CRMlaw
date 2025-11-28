import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
  fullScreen?: boolean;
}

const sizeClasses = {
  sm: 'w-6 h-6',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  message,
  fullScreen = false,
}) => {
  const content = (
    <div className="text-center">
      <Loader2 className={`${sizeClasses[size]} text-amber-600 animate-spin mx-auto`} />
      {message && <p className="text-slate-600 mt-3 text-sm">{message}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        {content}
      </div>
    );
  }

  return (
    <div className="flex min-h-[200px] items-center justify-center">
      {content}
    </div>
  );
};

export default LoadingSpinner;
