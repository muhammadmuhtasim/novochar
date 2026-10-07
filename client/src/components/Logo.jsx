import React from 'react';

export default function Logo({ size = 36, className = '' }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Glow filter for the accretion disk */}
        <filter id="bhGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Soft glow for the ambient light */}
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="blur" />
        </filter>

        {/* Accretion disk — front band. Doppler beaming: left side is blazing white, right side fades to ember. */}
        <linearGradient id="frontDiskGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="25%" stopColor="#FFF8D6" />
          <stop offset="50%" stopColor="#FFDD88" />
          <stop offset="75%" stopColor="#FF8800" />
          <stop offset="100%" stopColor="#CC3300" />
        </linearGradient>

        {/* Accretion disk — top lensed arc. Light bent over the shadow. */}
        <radialGradient id="topArcGrad" cx="50%" cy="100%" r="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="20%" stopColor="#FFEEAA" />
          <stop offset="50%" stopColor="#FF9900" />
          <stop offset="80%" stopColor="#CC2200" />
          <stop offset="100%" stopColor="#440800" />
        </radialGradient>

        {/* Accretion disk — bottom lensed arc. Light bent under the shadow. */}
        <radialGradient id="bottomArcGrad" cx="50%" cy="0%" r="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="20%" stopColor="#FFEEAA" />
          <stop offset="50%" stopColor="#FF9900" />
          <stop offset="80%" stopColor="#CC2200" />
          <stop offset="100%" stopColor="#440800" />
        </radialGradient>

        {/* Event horizon — pure black core */}
        <radialGradient id="bhCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" />
          <stop offset="85%" stopColor="#000000" />
          <stop offset="100%" stopColor="#1A0A00" />
        </radialGradient>

        {/* Ambient cosmic glow */}
        <radialGradient id="bgGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFAA33" stopOpacity="0.15" />
          <stop offset="40%" stopColor="#FF4400" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Deep space background */}
      <rect width="120" height="120" fill="#050508" />
      
      {/* Ambient nebula glow */}
      <circle cx="60" cy="60" r="58" fill="url(#bgGlow)" />

      {/* Starfield */}
      <g fill="#FFFFFF" opacity="0.8">
        <circle cx="15" cy="20" r="0.8" />
        <circle cx="100" cy="15" r="1.2" />
        <circle cx="25" cy="95" r="0.6" />
        <circle cx="105" cy="90" r="1.0" />
        <circle cx="10" cy="55" r="0.9" />
        <circle cx="110" cy="45" r="0.7" />
        <circle cx="45" cy="10" r="1.1" />
        <circle cx="80" cy="110" r="0.8" />
        <circle cx="30" cy="40" r="0.5" />
        <circle cx="95" cy="75" r="0.9" />
        <circle cx="50" cy="115" r="0.6" />
        <circle cx="115" cy="65" r="0.7" />
        <circle cx="5" cy="80" r="1.0" />
        <circle cx="75" cy="5" r="0.8" />
      </g>

      {/* Accretion disk — far half (top arc) */}
      <path
        d="M 15 60 A 45 18 0 0 1 105 60"
        fill="none"
        stroke="url(#topArcGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        filter="url(#bhGlow)"
      />

      {/* Accretion disk — far half (bottom arc) */}
      <path
        d="M 15 60 A 45 18 0 0 0 105 60"
        fill="none"
        stroke="url(#bottomArcGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        filter="url(#bhGlow)"
      />

      {/* Event horizon (the shadow) */}
      <circle cx="60" cy="60" r="21" fill="url(#bhCore)" />

      {/* Photon ring — light orbiting the black hole */}
      <circle
        cx="60"
        cy="60"
        r="22"
        fill="none"
        stroke="#FFEEDD"
        strokeWidth="1.2"
        opacity="0.9"
        filter="url(#bhGlow)"
      />
      <circle
        cx="60"
        cy="60"
        r="22.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="0.5"
        opacity="0.6"
      />

      {/* Accretion disk — near half (front band) */}
      <path
        d="M 10 60 Q 60 74 110 60"
        fill="none"
        stroke="url(#frontDiskGrad)"
        strokeWidth="5"
        strokeLinecap="round"
        filter="url(#bhGlow)"
      />
      
      {/* Bright core of the front band */}
      <path
        d="M 12 60 Q 60 73 108 60"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}