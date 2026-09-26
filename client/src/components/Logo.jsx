import React from 'react';

export default function Logo({ size = 34 }) {
  return (
    <svg
      className="logo"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle cx="32" cy="34" r="13" fill="none" stroke="#ff6a00" strokeWidth="2.4" />
      <circle cx="32" cy="34" r="4" fill="#ff6a00" />
      <ellipse cx="32" cy="34" rx="26" ry="9.5" fill="none" stroke="#ffa13d" strokeWidth="1.6" transform="rotate(-16 32 34)" opacity="0.85" />
      <circle cx="49" cy="23" r="2.2" fill="#ffcf7a" />
      <circle cx="18" cy="46" r="1.6" fill="#ff8a3c" />
      <path d="M7 7 L11 11 M7 7 L3 11 M57 7 L61 11 M57 7 L53 11 M7 57 L11 53 M7 57 L3 53 M57 57 L61 53 M57 57 L53 53" stroke="#ff6a00" strokeWidth="1.4" opacity="0.7" />
    </svg>
  );
}