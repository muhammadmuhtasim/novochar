import React from 'react';

export default function Logo({ size = 36, className = '' }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="-20 -20 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ overflow: 'visible' }}
    >
      <defs>
        {/* Glow Filters */}
        <filter id="heavyBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="blur" />
        </filter>
        <filter id="mediumBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
        </filter>
        <filter id="lightBlur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
        </filter>

        {/* Doppler Beamed Front Disk Gradient */}
        <linearGradient id="frontDiskGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="15%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="40%" stopColor="#FFDDAA" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#FF6600" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#660000" stopOpacity="0" />
        </linearGradient>

        <linearGradient id="frontDiskCoreGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="20%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="50%" stopColor="#FFCC88" stopOpacity="1" />
          <stop offset="85%" stopColor="#FF3300" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#330000" stopOpacity="0" />
        </linearGradient>

        {/* Top Lensed Arc Gradients */}
        <radialGradient id="topArcGrad" cx="50%" cy="80%" r="80%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="30%" stopColor="#FFB344" stopOpacity="0.9" />
          <stop offset="70%" stopColor="#CC3300" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#110000" stopOpacity="0" />
        </radialGradient>

        {/* Bottom Lensed Arc Gradients */}
        <radialGradient id="bottomArcGrad" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="40%" stopColor="#FF8800" stopOpacity="0.6" />
          <stop offset="80%" stopColor="#991100" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>

        {/* Ambient Cosmic Background Glow */}
        <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF6600" stopOpacity="0.3" />
          <stop offset="30%" stopColor="#FF1100" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Transparent bounding circle */}
      <circle cx="60" cy="60" r="60" fill="transparent" />
      
      {/* Ambient outer glow */}
      <circle cx="60" cy="60" r="55" fill="url(#bgGlow)" filter="url(#heavyBlur)" />

      {/* Subtle Starfield */}
      <g fill="#FFFFFF" opacity="0.5">
        <circle cx="15" cy="20" r="0.8" />
        <circle cx="105" cy="15" r="1.2" />
        <circle cx="20" cy="90" r="0.6" />
        <circle cx="95" cy="100" r="0.9" />
        <circle cx="10" cy="60" r="0.7" />
        <circle cx="112" cy="55" r="0.8" />
      </g>

      {/* 1. TOP LENSED ARC (Filled shape for natural tapering) */}
      <path
        d="M -5 62 C -5 -5, 125 -5, 125 62 C 90 30, 30 30, -5 62 Z"
        fill="url(#topArcGrad)"
        filter="url(#heavyBlur)"
        opacity="0.8"
      />
      <path
        d="M 8 62 C 8 10, 112 10, 112 62 C 85 36, 35 36, 8 62 Z"
        fill="url(#topArcGrad)"
        filter="url(#mediumBlur)"
      />
      <path
        d="M 18 62 C 18 20, 102 20, 102 62 C 80 40, 40 40, 18 62 Z"
        fill="#FFE0B2"
        filter="url(#lightBlur)"
        opacity="0.9"
      />

      {/* 2. BOTTOM LENSED ARC */}
      <path
        d="M 10 60 C 10 110, 110 110, 110 60 C 85 80, 35 80, 10 60 Z"
        fill="url(#bottomArcGrad)"
        filter="url(#heavyBlur)"
        opacity="0.7"
      />
      <path
        d="M 18 60 C 18 95, 102 95, 102 60 C 80 75, 40 75, 18 60 Z"
        fill="url(#bottomArcGrad)"
        filter="url(#mediumBlur)"
        opacity="0.8"
      />

      {/* 3. EVENT HORIZON (The black shadow) */}
      <circle cx="60" cy="60" r="24" fill="#000000" />

      {/* Photon Ring (Sharp bright ring) */}
      <circle
        cx="60"
        cy="60"
        r="24"
        fill="none"
        stroke="#FFCC88"
        strokeWidth="1.5"
        filter="url(#lightBlur)"
        opacity="0.8"
      />
      <circle
        cx="60"
        cy="60"
        r="24"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="0.5"
        opacity="0.9"
      />

      {/* 4. FRONT ACCRETION DISK (Filled shape for natural tapering) */}
      {/* Heavy Blur Outer Glow */}
      <path
        d="M -10 62 Q 60 90 130 62 Q 60 50 -10 62 Z"
        fill="url(#frontDiskGrad)"
        filter="url(#heavyBlur)"
      />
      {/* Medium Blur Inner Glow */}
      <path
        d="M -5 62 Q 60 82 125 62 Q 60 55 -5 62 Z"
        fill="url(#frontDiskCoreGrad)"
        filter="url(#mediumBlur)"
      />
      {/* Intense bright core */}
      <path
        d="M 0 62 Q 60 76 120 62 Q 60 58 0 62 Z"
        fill="url(#frontDiskCoreGrad)"
        filter="url(#lightBlur)"
      />
      {/* Piercing white hot center for Doppler beaming */}
      <path
        d="M 2 62 Q 40 72 80 64 Q 40 60 2 62 Z"
        fill="#FFFFFF"
        filter="url(#lightBlur)"
        opacity="0.9"
      />
    </svg>
  );
}