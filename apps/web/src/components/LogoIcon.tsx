import React from 'react';

export function LogoIcon({ className = "w-5 h-5", color = "#FFC400" }: { className?: string; color?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer Hexagonal Container for Logistics Node */}
      <path
        d="M12 2L21 7.2V16.8L12 22L3 16.8V7.2L12 2Z"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Inner Interconnected Agent Networks / Box structure */}
      <path
        d="M12 22V12"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12L21 7.2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 12L3 7.2"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Center glowing node dot */}
      <circle cx="12" cy="12" r="2.2" fill={color} />
      {/* Satellite agent nodes */}
      <circle cx="12" cy="5.2" r="1.2" fill={color} />
      <circle cx="6.5" cy="15.2" r="1.2" fill={color} />
      <circle cx="17.5" cy="15.2" r="1.2" fill={color} />
    </svg>
  );
}
