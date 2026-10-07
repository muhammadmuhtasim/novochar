import React from 'react';

export default function Logo({ size = 36, className = '' }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Core Starflare Radial Glow */}
        <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="1" />
          <stop offset="25%" stopColor="#FFB700" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#FF4400" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#FF1100" stopOpacity="0" />
        </radialGradient>

        {/* Deep Space Cosmic Arc Gradient */}
        <linearGradient id="cosmicArcGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF9900" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#FF4400" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#FF1100" stopOpacity="0.2" />
        </linearGradient>

        {/* Astrometric Vector Gradient */}
        <linearGradient id="vectorGrad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF3300" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#FF8800" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#FFC800" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Celestial Coordinate Grid Arc (Astrolabe / Sky Viewer Arc) */}
      <path
        d="M 8 32 A 24 24 0 0 1 56 32"
        fill="none"
        stroke="#FF5500"
        strokeWidth="1.2"
        strokeDasharray="2 4"
        opacity="0.5"
      />

      {/* Cosmic Horizon Sweep / SPHEREx Sky Pass Arc */}
      <path
        d="M 10 46 C 16 18, 48 18, 54 46"
        fill="none"
        stroke="url(#cosmicArcGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />

      {/* Blink Comparator Proper Motion Vector Line (connects binary star positions) */}
      <line
        x1="18"
        y1="40"
        x2="46"
        y2="22"
        stroke="url(#vectorGrad)"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />

      {/* Primary Deep-Space Starburst (Telescope Diffraction Spike Optics) */}
      <path
        d="M 32 10 Q 32 32 10 32 Q 32 32 32 54 Q 32 32 54 32 Q 32 32 32 10 Z"
        fill="url(#starGlow)"
        opacity="0.95"
      />

      {/* Secondary Diagonal Flare Rays */}
      <path
        d="M 32 20 Q 32 32 20 32 Q 32 32 32 44 Q 32 32 44 32 Q 32 32 32 20 Z"
        fill="#FFBB00"
        opacity="0.4"
        transform="rotate(45 32 32)"
      />

      {/* Crisp Central Stellar Core */}
      <circle cx="32" cy="32" r="3.5" fill="#FFFFFF" />

      {/* Blink Target: Displaced Candidate Star (High Proper Motion / Moving Object) */}
      <circle cx="46" cy="22" r="3" fill="#FFCC00" />
      <circle cx="46" cy="22" r="1.4" fill="#FFFFFF" />

      {/* Celestial Focal Point Rings (Astrometric Scope Mark) */}
      <circle cx="32" cy="32" r="15" fill="none" stroke="#FF6600" strokeWidth="1" strokeDasharray="12 6" opacity="0.6" />
    </svg>
  );
}