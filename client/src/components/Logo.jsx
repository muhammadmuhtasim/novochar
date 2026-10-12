import React, { useId } from 'react';

export default function BlackHole({ size = 240, tilt = 0, className = '' }) {
  // Unique IDs for safe reusability across multiple instances
  const uid = useId().replace(/:/g, '');
  const id = (name) => `${name}-${uid}`;
  const url = (name) => `url(#${id(name)})`;

  const CX = 120;
  const CY = 66;
  const R = 27.5; // Event horizon shadow radius

  // Slightly enlarged gold halo behind the red layers
  const GOLD_SCALE = `translate(${CX} ${CY}) scale(1.04 1.07) translate(${-CX} ${-CY})`;

  // --- TOP ARCH (Upper Lensed Disk) ---
  const TOP_ARCH_RED =
    'M 12 66 ' +
    'C 42 66, 70 54, 86 39 ' +
    'C 98 27, 106 16, 120 16 ' +
    'C 134 16, 142 27, 154 39 ' +
    'C 170 54, 198 66, 228 66 ' +
    'C 185 66, 152 38.5, 120 38.5 ' +
    'C 88 38.5, 55 66, 12 66 Z';

  const TOP_ARCH_ORANGE =
    'M 18 66 ' +
    'C 46 66, 72 55, 87 41 ' +
    'C 98 29, 107 21, 120 21 ' +
    'C 133 21, 142 29, 153 41 ' +
    'C 168 55, 194 66, 222 66 ' +
    'C 182 66, 150 38.5, 120 38.5 ' +
    'C 90 38.5, 58 66, 18 66 Z';

  const TOP_ARCH_YELLOW =
    'M 25 66 ' +
    'C 50 66, 74 56, 88 43 ' +
    'C 99 32, 107 26, 120 26 ' +
    'C 133 26, 141 32, 152 43 ' +
    'C 166 56, 190 66, 215 66 ' +
    'C 178 66, 148 38.5, 120 38.5 ' +
    'C 92 38.5, 62 66, 25 66 Z';

  const TOP_ARCH_WHITE =
    'M 35 66 ' +
    'C 58 66, 78 57, 90 45 ' +
    'C 100 35, 108 31.5, 120 31.5 ' +
    'C 132 31.5, 140 35, 150 45 ' +
    'C 162 57, 182 66, 205 66 ' +
    'C 172 66, 145 38.5, 120 38.5 ' +
    'C 95 38.5, 68 66, 35 66 Z';

  // --- BOTTOM ARCH (Lower Lensed Ring) --- gold/orange only, no white layer
  const BOTTOM_ARCH_RED =
    'M 66 66 ' +
    'C 66 94, 86 115, 120 115 ' +
    'C 154 115, 174 94, 174 66 ' +
    'C 156 86, 140 93.5, 120 93.5 ' +
    'C 100 93.5, 84 86, 66 66 Z';

  const BOTTOM_ARCH_ORANGE =
    'M 70 66 ' +
    'C 70 92, 88 110, 120 110 ' +
    'C 152 110, 170 92, 170 66 ' +
    'C 154 86, 139 93.5, 120 93.5 ' +
    'C 101 93.5, 86 86, 70 66 Z';

  const BOTTOM_ARCH_YELLOW =
    'M 75 66 ' +
    'C 75 90, 91 104.5, 120 104.5 ' +
    'C 149 104.5, 165 90, 165 66 ' +
    'C 151 85, 137 93.5, 120 93.5 ' +
    'C 103 93.5, 89 85, 75 66 Z';

  // --- FRONT ACCRETION DISK --- starts at the shadow's midline, extends below
  const FRONT_DISK_RED =
    'M 10 68 C 45 68, 75 64.5, 120 64.5 C 165 64.5, 195 68, 230 68 ' +
    'C 195 68, 165 77.5, 120 77.5 C 75 77.5, 45 68, 10 68 Z';

  const FRONT_DISK_ORANGE =
    'M 14 68 C 46 68, 76 65.5, 120 65.5 C 164 65.5, 194 68, 226 68 ' +
    'C 194 68, 164 76, 120 76 C 76 76, 46 68, 14 68 Z';

  const FRONT_DISK_YELLOW =
    'M 18 68 C 48 68, 78 66.5, 120 66.5 C 162 66.5, 192 68, 222 68 ' +
    'C 192 68, 162 74.5, 120 74.5 C 78 74.5, 48 68, 18 68 Z';

  const FRONT_DISK_WHITE =
    'M 24 68 C 52 68, 80 67.5, 120 67.5 C 160 67.5, 188 68, 216 68 ' +
    'C 188 68, 160 72.5, 120 72.5 C 80 72.5, 52 68, 24 68 Z';

  // User-space filter regions: no element can be dropped because of a
  // zero-size bounding box, and blurs never get clipped.
  const blur = (name, sd) => (
    <filter id={id(name)} filterUnits="userSpaceOnUse" x="-40" y="-40" width="320" height="220">
      <feGaussianBlur stdDeviation={sd} />
    </filter>
  );

  return (
    <svg
      className={`black-hole ${className}`.trim()}
      width={size}
      height={size * (132 / 240)}
      viewBox="0 0 240 132"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ overflow: 'visible', background: 'transparent' }}
    >
      <defs>
        {/* Blur Filters */}
        {blur('b04', 0.4)}
        {blur('b09', 0.8)}
        {blur('b10', 1.2)}
        {blur('b12', 2.4)}
        {blur('glow', 6)}
        {blur('glowWide', 12)}

        {/* Color Shift Gradients */}
        <linearGradient id={id('coreWhite')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FF836B" />
          <stop offset="18%" stopColor="#FFB399" />
          <stop offset="38%" stopColor="#FFFFFF" />
          <stop offset="65%" stopColor="#FFFFFF" />
          <stop offset="85%" stopColor="#FFE085" />
          <stop offset="100%" stopColor="#E5A028" />
        </linearGradient>

        <linearGradient id={id('coreYellow')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFB03A" />
          <stop offset="25%" stopColor="#FFD866" />
          <stop offset="50%" stopColor="#FFF2A3" />
          <stop offset="75%" stopColor="#FFD866" />
          <stop offset="100%" stopColor="#F29F05" />
        </linearGradient>

        <linearGradient id={id('coreOrange')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#E64A19" />
          <stop offset="30%" stopColor="#FF6D00" />
          <stop offset="50%" stopColor="#FF9100" />
          <stop offset="70%" stopColor="#FF6D00" />
          <stop offset="100%" stopColor="#DD3B00" />
        </linearGradient>

        <linearGradient id={id('coreRed')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#990000" />
          <stop offset="20%" stopColor="#C62828" />
          <stop offset="50%" stopColor="#E53935" />
          <stop offset="80%" stopColor="#C62828" />
          <stop offset="100%" stopColor="#800000" />
        </linearGradient>

        {/* Outermost gold glow */}
        <linearGradient id={id('coreGold')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#E8A21E" />
          <stop offset="50%" stopColor="#FFD04A" />
          <stop offset="100%" stopColor="#E8A21E" />
        </linearGradient>

        {/* Fades the lower arch out toward the disk */}
        <linearGradient id={id('fade')} gradientUnits="userSpaceOnUse" x1="66" y1="0" x2="174" y2="0">
          <stop offset="0%" stopColor="#fff" stopOpacity="0" />
          <stop offset="25%" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="50%" stopColor="#fff" stopOpacity="1" />
          <stop offset="75%" stopColor="#fff" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={id('arcMask')} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="132">
          <rect x="0" y="0" width="240" height="132" fill={url('fade')} />
        </mask>
      </defs>

      <g transform={`rotate(${tilt} ${CX} ${CY})`}>
        {/* 1. Ambient Background Glows */}
        <ellipse cx={CX} cy={CY} rx={105} ry={22} fill="#E63900" opacity="0.35" filter={url('glowWide')} />
        <ellipse cx={CX} cy={CY} rx={85} ry={35} fill="#FF6D00" opacity="0.25" filter={url('glow')} />

        {/* 2. Bottom Lensed Arch (Under Shadow), faded toward the disk */}
        <g mask={url('arcMask')}>
          <g transform={GOLD_SCALE}>
            <path d={BOTTOM_ARCH_RED} fill={url('coreGold')} filter={url('b12')} opacity="0.9" />
          </g>
          <path d={BOTTOM_ARCH_RED} fill={url('coreRed')} filter={url('b12')} opacity="0.85" />
          <path d={BOTTOM_ARCH_ORANGE} fill={url('coreOrange')} filter={url('b10')} />
          <path d={BOTTOM_ARCH_YELLOW} fill={url('coreYellow')} filter={url('b09')} />
        </g>

        {/* 3. Top Lensed Arch (Over Shadow) */}
        <g>
          <g transform={GOLD_SCALE}>
            <path d={TOP_ARCH_RED} fill={url('coreGold')} filter={url('b12')} opacity="0.9" />
          </g>
          <path d={TOP_ARCH_RED} fill={url('coreRed')} filter={url('b12')} opacity="0.85" />
          <path d={TOP_ARCH_ORANGE} fill={url('coreOrange')} filter={url('b10')} />
          <path d={TOP_ARCH_YELLOW} fill={url('coreYellow')} filter={url('b09')} />
          <path d={TOP_ARCH_WHITE} fill={url('coreWhite')} filter={url('b04')} />
        </g>

        {/* 4. Central Black Shadow & Thin Photon Ring */}
        <g>
          <circle cx={CX} cy={CY} r={R + 1.8} fill="#000000" opacity="0.7" filter={url('b10')} />
          <circle cx={CX} cy={CY} r={R} fill="#000000" />
          <circle
            cx={CX}
            cy={CY}
            r={R}
            stroke="#FFA896"
            strokeWidth="1.6"
            fill="none"
            filter={url('b09')}
            opacity="0.85"
          />
          <circle
            cx={CX}
            cy={CY}
            r={R}
            stroke="#FFFFFF"
            strokeWidth="0.7"
            fill="none"
            opacity="0.95"
          />
        </g>

        {/* 5. Front Accretion Disk (Crosses Shadow in Front) */}
        <g>
          <g transform={GOLD_SCALE}>
            <path d={FRONT_DISK_RED} fill={url('coreGold')} filter={url('b12')} opacity="0.9" />
          </g>
          <path d={FRONT_DISK_RED} fill={url('coreRed')} filter={url('b12')} opacity="0.9" />
          <path d={FRONT_DISK_ORANGE} fill={url('coreOrange')} filter={url('b10')} />
          <path d={FRONT_DISK_YELLOW} fill={url('coreYellow')} filter={url('b09')} />
          <path d={FRONT_DISK_WHITE} fill={url('coreWhite')} filter={url('b04')} />

          {/* Equatorial White Seam (rects, so the blur filter actually renders) */}
          <rect x="28" y="67.4" width="184" height="1.2" fill="#FFFFFF" filter={url('b09')} opacity="0.9" />
          <rect x="32" y="67.7" width="176" height="0.6" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
}