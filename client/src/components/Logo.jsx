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
        {/* Core Starburst Radial Glow */}
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFF2E6" stopOpacity="1" />
          <stop offset="30%" stopColor="#FF7700" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#FF3300" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#FF1A00" stopOpacity="0" />
        </radialGradient>

        {/* Orbit Gradient 1 */}
        <linearGradient id="orbitGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFB700" />
          <stop offset="50%" stopColor="#FF5500" />
          <stop offset="100%" stopColor="#FF1100" />
        </linearGradient>

        {/* Orbit Gradient 2 */}
        <linearGradient id="orbitGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FF3300" />
          <stop offset="60%" stopColor="#FF9900" />
          <stop offset="100%" stopColor="#FFE680" />
        </linearGradient>
      </defs>

      {/* Floating Optical Axis Crosshair Ticks (Borderless, pure precision alignment marks) */}
      <line x1="32" y1="4" x2="32" y2="11" stroke="#FF5500" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
      <line x1="32" y1="53" x2="32" y2="60" stroke="#FF5500" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
      <line x1="4" y1="32" x2="11" y2="32" stroke="#FF5500" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />
      <line x1="53" y1="32" x2="60" y2="32" stroke="#FF5500" strokeWidth="1.8" strokeLinecap="round" opacity="0.75" />

      {/* Primary Celestial Orbit Ellipse */}
      <ellipse
        cx="32"
        cy="32"
        rx="24"
        ry="10"
        fill="none"
        stroke="url(#orbitGrad1)"
        strokeWidth="2.2"
        transform="rotate(-28 32 32)"
      />

      {/* Counter Orbital Sweep (Forms aperture / lens overlap) */}
      <ellipse
        cx="32"
        cy="32"
        rx="24"
        ry="10"
        fill="none"
        stroke="url(#orbitGrad2)"
        strokeWidth="1.6"
        strokeDasharray="40 12 10 8"
        transform="rotate(32 32 32)"
        opacity="0.85"
      />

      {/* Core Celestial Focal Ring */}
      <circle cx="32" cy="32" r="10" fill="none" stroke="#FF7700" strokeWidth="1.5" opacity="0.9" />

      {/* Core Star / Transient Source Glow */}
      <circle cx="32" cy="32" r="9" fill="url(#coreGlow)" />
      <circle cx="32" cy="32" r="3.2" fill="#FFFFFF" />

      {/* Orbiting Satellite / Transient Object Nodes */}
      {/* Node 1: Top-right transient object */}
      <circle cx="49" cy="18" r="2.8" fill="#FFC800" />
      <circle cx="49" cy="18" r="1.2" fill="#FFFFFF" />

      {/* Node 2: Bottom-left reference object */}
      <circle cx="15" cy="46" r="2.2" fill="#FF4400" />
    </svg>
  );
}