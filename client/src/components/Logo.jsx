import React, { useId } from 'react';

export default function BlackHole({ size = 240, tilt = -11, className = '' }) {
  // unique ids so multiple instances on a page don't clash
  const uid = useId().replace(/:/g, '');
  const id = (name) => `${name}-${uid}`;

  return (
    <svg
      className={`black-hole ${className}`.trim()}
      width={size}
      height={size * (140 / 240)}
      viewBox="0 0 240 140"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ overflow: 'visible', background: 'transparent' }}
    >
      <defs>
        <filter id={id('blurHeavy')} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={id('blurMed')} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
        <filter id={id('blurLight')} x="-50%" y="-100%" width="200%" height="300%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>

        {/* Lensed halo over the top: orange outside, pale cream inside */}
        <radialGradient id={id('halo')} cx="50%" cy="75%" r="75%">
          <stop offset="0%" stopColor="#FFF1DC" stopOpacity="1" />
          <stop offset="35%" stopColor="#FFC27A" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#E8581C" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7A1500" stopOpacity="0" />
        </radialGradient>

        {/* Flat disk, fades out toward both tips */}
        <linearGradient id={id('disk')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF7A33" stopOpacity="0" />
          <stop offset="12%" stopColor="#FFA060" stopOpacity="0.7" />
          <stop offset="35%" stopColor="#FFE2BC" stopOpacity="1" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="65%" stopColor="#FFE2BC" stopOpacity="1" />
          <stop offset="88%" stopColor="#FF9A55" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FF6A2A" stopOpacity="0" />
        </linearGradient>

        {/* Thin lensed arc under the shadow */}
        <linearGradient id={id('under')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF8A3D" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFD3A0" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FF8A3D" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g transform={`rotate(${tilt} 120 70)`}>
        {/* 1. Soft outer glow of the flat disk */}
        <path
          d="M 0 72 Q 120 50 240 72 Q 120 94 0 72 Z"
          fill={`url(#${id('disk')})`}
          filter={`url(#${id('blurHeavy')})`}
          opacity="0.55"
        />

        {/* 2. Top lensed arc (back of the disk bent over the shadow) */}
        <path
          d="M 14 74 C 55 72, 62 14, 120 14 C 178 14, 185 72, 226 74
             C 196 64, 178 36, 120 36 C 62 36, 44 64, 14 74 Z"
          fill={`url(#${id('halo')})`}
          filter={`url(#${id('blurHeavy')})`}
          opacity="0.85"
        />
        <path
          d="M 22 74 C 60 72, 68 22, 120 22 C 172 22, 180 72, 218 74
             C 192 64, 176 38, 120 38 C 64 38, 48 64, 22 74 Z"
          fill={`url(#${id('halo')})`}
          filter={`url(#${id('blurMed')})`}
        />
        {/* thin bright rim hugging the shadow */}
        <path
          d="M 40 70 C 66 66, 74 30, 120 30 C 166 30, 174 66, 200 70"
          stroke="#FFF4E4"
          strokeWidth="2"
          strokeLinecap="round"
          filter={`url(#${id('blurLight')})`}
          opacity="0.9"
        />

        {/* 3. Thin lensed arc below the shadow */}
        <path
          d="M 84 98 Q 120 116 156 98"
          stroke={`url(#${id('under')})`}
          strokeWidth="6"
          strokeLinecap="round"
          filter={`url(#${id('blurMed')})`}
          opacity="0.8"
        />
        <path
          d="M 90 99 Q 120 112 150 99"
          stroke={`url(#${id('under')})`}
          strokeWidth="1.8"
          strokeLinecap="round"
          filter={`url(#${id('blurLight')})`}
        />

        {/* 4. Event horizon */}
        <circle cx="120" cy="70" r="26" fill="#000" />
        <circle
          cx="120"
          cy="70"
          r="26"
          stroke="#FFD9A8"
          strokeWidth="1.2"
          filter={`url(#${id('blurLight')})`}
          opacity="0.7"
        />
        <circle cx="120" cy="70" r="26" stroke="#FFFFFF" strokeWidth="0.4" opacity="0.8" />

        {/* 5. Front accretion disk crossing the shadow */}
        <path
          d="M 4 74 C 50 88, 90 94, 120 92 C 165 90, 205 80, 236 68
             C 205 74, 165 78, 120 78 C 80 78, 45 76, 4 74 Z"
          fill={`url(#${id('disk')})`}
          filter={`url(#${id('blurMed')})`}
          opacity="0.9"
        />
        <path
          d="M 10 75 C 55 86, 92 90, 120 88 C 160 86, 200 78, 230 70
             C 200 75, 162 79, 120 79 C 82 79, 50 77, 10 75 Z"
          fill={`url(#${id('disk')})`}
          filter={`url(#${id('blurLight')})`}
        />
        {/* white-hot core of the band */}
        <path
          d="M 70 78 C 95 84, 125 85, 160 80 C 130 79, 100 79, 70 78 Z"
          fill="#FFFFFF"
          filter={`url(#${id('blurLight')})`}
          opacity="0.95"
        />
      </g>
    </svg>
  );
}