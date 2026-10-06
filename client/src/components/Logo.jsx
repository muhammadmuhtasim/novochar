import React from 'react';

export default function Logo({ size = 36 }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      {/* Outer Tactical Reticle Frame */}
      <polygon
        points="10,2 54,2 62,10 62,54 54,62 10,62 2,54 2,10"
        fill="none"
        stroke="#FF4D00"
        strokeWidth="1.8"
        opacity="0.85"
      />
      {/* Inner Target Crosshairs */}
      <line x1="32" y1="6" x2="32" y2="16" stroke="#FF6A00" strokeWidth="1.6" />
      <line x1="32" y1="48" x2="32" y2="58" stroke="#FF6A00" strokeWidth="1.6" />
      <line x1="6" y1="32" x2="16" y2="32" stroke="#FF6A00" strokeWidth="1.6" />
      <line x1="48" y1="32" x2="58" y2="32" stroke="#FF6A00" strokeWidth="1.6" />
      
      {/* Core Orbital Ring */}
      <circle cx="32" cy="32" r="13" fill="none" stroke="#FF6A00" strokeWidth="2.2" />
      <ellipse cx="32" cy="32" rx="23" ry="8" fill="none" stroke="#FF9E00" strokeWidth="1.4" transform="rotate(-20 32 32)" opacity="0.9" />
      
      {/* Glowing Star Candidate Nodes */}
      <circle cx="32" cy="32" r="4.5" fill="#FF4D00" />
      <circle cx="48" cy="22" r="2.8" fill="#FF9E00" />
      <circle cx="16" cy="42" r="2.2" fill="#FFE600" />
      
      {/* Corner Brackets */}
      <path d="M6 14 L6 6 L14 6 M58 14 L58 6 L50 6 M6 50 L6 58 L14 58 M58 50 L58 58 L50 58" stroke="#FF4D00" strokeWidth="1.5" />
    </svg>
  );
}