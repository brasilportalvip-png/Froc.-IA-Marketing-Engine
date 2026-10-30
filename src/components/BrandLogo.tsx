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
      <div className={`relative ${sizeClasses[size]} shrink-0 rounded-full group`}>
        <span className="absolute -inset-1 rounded-full bg-[#2d6bff]/30 blur-md opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
        {!imageError ? (
          <img
            src={size === 'xl' || size === 'lg' ? BRAND.logoLargeUrl : BRAND.logoUrl}
            alt="Froc.IA"
            width={64}
            height={64}
            onError={() => setImageError(true)}
            className="relative z-10 h-full w-full rounded-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="eager"
            decoding="async"
          />
        ) : (
          <div className="relative z-10 flex h-full w-full items-center justify-center rounded-full bg-slate-900 text-cyan-400">
            <Bot size={iconSizes[size]} className="animate-pulse" />
          </div>
        )}
      </div>

      {showText && (
        <div className="flex flex-col leading-none">
          <div className={`font-black tracking-tight text-white flex items-center gap-1 ${textSizes[size]}`}>
            <span>Froc</span>
            <span className="bg-gradient-to-r from-[#FFD400] via-[#FF2D87] to-[#00E676] bg-clip-text text-transparent">.IA</span>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#00E676] animate-ping ml-0.5" />
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
