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
        {/* Accretion disk — Doppler beaming: the approaching side burns white-hot,
            the receding side cools to ember red. Declared in user space so every
            fragment of the disk reads as one continuous sweep of light. */}
        <linearGradient id="bhDisk" gradientUnits="userSpaceOnUse" x1="5" y1="32" x2="59" y2="32">
          <stop offset="0%" stopColor="#FFFDF6" />
          <stop offset="15%" stopColor="#FFDE9B" />
          <stop offset="38%" stopColor="#FFA23C" />
          <stop offset="62%" stopColor="#F26210" />
          <stop offset="84%" stopColor="#9E2A00" />
          <stop offset="100%" stopColor="#4A0F00" />
        </linearGradient>

        {/* Photon ring — light that orbits the horizon a few times before escaping */}
        <linearGradient id="bhRing" gradientUnits="userSpaceOnUse" x1="18" y1="32" x2="46" y2="32">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="34%" stopColor="#FFE7B4" />
          <stop offset="68%" stopColor="#FF9A2E" />
          <stop offset="100%" stopColor="#B83600" />
        </linearGradient>

        {/* Ambient glow of superheated infalling matter */}
        <radialGradient id="bhHalo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FF8A1E" stopOpacity="0.40" />
          <stop offset="45%" stopColor="#FF4400" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#FF1100" stopOpacity="0" />
        </radialGradient>

        {/* Event horizon — the shadow itself */}
        <radialGradient id="bhCore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" />
          <stop offset="70%" stopColor="#04050A" />
          <stop offset="100%" stopColor="#0B0D18" />
        </radialGradient>
      </defs>

      {/* Ambient accretion glow */}
      <circle cx="32" cy="32" r="31" fill="url(#bhHalo)" />

      {/* Accretion disk — far half, rising up and around behind the horizon */}
      <path d="M 59 32 A 27 8.5 0 0 0 5 32" stroke="url(#bhDisk)" strokeWidth="8" opacity="0.16" />
      <path d="M 59 32 A 27 8.5 0 0 0 5 32" stroke="url(#bhDisk)" strokeWidth="3.6" />

      {/* Gravitationally lensed image of the far disk, bent into an arc over the shadow */}
      <path
        d="M 19.7 21.7 A 16 16 0 0 1 44.3 21.7"
        stroke="url(#bhDisk)"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.95"
      />

      {/* Event horizon */}
      <circle cx="32" cy="32" r="13" fill="url(#bhCore)" />

      {/* Photon ring — soft bloom, then a razor-thin orbit of light */}
      <circle cx="32" cy="32" r="14.3" stroke="url(#bhRing)" strokeWidth="3.4" opacity="0.3" />
      <circle cx="32" cy="32" r="14.3" stroke="url(#bhRing)" strokeWidth="1.2" />

      {/* Accretion disk — near half, sweeping in front of the shadow */}
      <path d="M 5 32 A 27 8.5 0 0 0 59 32" stroke="url(#bhDisk)" strokeWidth="8" opacity="0.16" />
      <path d="M 5 32 A 27 8.5 0 0 0 59 32" stroke="url(#bhDisk)" strokeWidth="3.6" />
    </svg>
  );
}