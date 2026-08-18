import React, { useState } from 'react';
import { Bot, Sparkles } from 'lucide-react';
import { BRAND } from '../lib/brand';

interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
  subtitle = 'Marketing Engine'
}) => {
  const [imageError, setImageError] = useState(false);

  const sizeClasses = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-12 h-12 rounded-2xl',
    xl: 'w-16 h-16 rounded-2xl'
  };

  const iconSizes = {
    sm: 16,
    md: 20,
    lg: 24,
    xl: 32
  };

  const textSizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
    xl: 'text-2xl'
  };

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      <div
        className={`relative ${sizeClasses[size]} p-[2px] bg-gradient-to-tr from-blue-600 via-cyan-400 to-indigo-500 shadow-lg shadow-cyan-500/20 shrink-0 overflow-hidden group`}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-cyan-400 to-blue-600 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {!imageError ? (
          <img
            src={BRAND.mascotUrl}
            alt="Froc.IA"
            referrerPolicy="no-referrer"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover rounded-[inherit] relative z-10 bg-slate-900 transition-transform duration-300 group-hover:scale-105"
            loading="eager"
          />
        ) : (
          <div className="w-full h-full bg-slate-900 rounded-[inherit] flex items-center justify-center text-cyan-400 relative z-10">
            <Bot size={iconSizes[size]} className="animate-pulse" />
          </div>
        )}
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <div className={`font-black tracking-tight text-white flex items-center gap-1 ${textSizes[size]}`}>
            <span>Froc</span>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">.IA</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping ml-0.5" />
          </div>
          {subtitle && (
            <span className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase mt-1">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
