'use client';

/**
 * The ambient globe.
 *
 * Deliberately backdrop rather than subject: the hero's thesis is the
 * negotiation in front of it. The globe carries one piece of information —
 * that these deals move physical cargo between real ports — and is otherwise
 * quiet, dark, and slowly turning.
 *
 * Arcs run between the ports named in the negotiation, so the backdrop and the
 * foreground are describing the same trade rather than being decorative.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';

// react-globe.gl touches window and WebGL at import time, so it cannot be
// server-rendered.
const Globe = dynamic(() => import('react-globe.gl'), { ssr: false });

export interface Lane {
  readonly from: string;
  readonly to: string;
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number;
  readonly endLng: number;
}

export const LANES: readonly Lane[] = [
  { from: 'Rotterdam', to: 'Mumbai', startLat: 51.95, startLng: 4.14, endLat: 18.94, endLng: 72.84 },
  { from: 'Shanghai', to: 'Hamburg', startLat: 31.23, startLng: 121.47, endLat: 53.55, endLng: 9.99 },
  { from: 'Santos', to: 'Algeciras', startLat: -23.96, startLng: -46.33, endLat: 36.13, endLng: -5.45 },
  { from: 'Singapore', to: 'Felixstowe', startLat: 1.29, startLng: 103.85, endLat: 51.96, endLng: 1.35 },
  { from: 'Jebel Ali', to: 'Antwerp', startLat: 25.01, startLng: 55.06, endLat: 51.26, endLng: 4.4 },
];

export function GlobeField({ className = '' }: { className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  // react-globe.gl types its ref as a MutableRefObject of GlobeMethods.
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /*
   * The globe's surface material.
   *
   * A Phong material rather than a texture image. No CDN asset — that is a
   * fragility a demo cannot afford, and a strict CSP would block it outright —
   * and a photographic earth would fight the machine-hall language of the rest
   * of the product. A dark sphere carrying only the trade lanes says enough.
   *
   * Built once: a new material each render would rebuild the GPU program.
   */
  const globeMaterial = useMemo(
    () => new MeshPhongMaterial({ color: '#171a20', shininess: 6 }),
    [],
  );

  const points = useMemo(
    () =>
      LANES.flatMap((lane) => [
        { lat: lane.startLat, lng: lane.startLng, name: lane.from },
        { lat: lane.endLat, lng: lane.endLng, name: lane.to },
      ]),
    [],
  );

  return (
    <div ref={holder} className={className} aria-hidden>
      {size.width > 0 ? (
        <Globe
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          showAtmosphere
          atmosphereColor="#ffc400"
          atmosphereAltitude={0.14}
          globeMaterial={globeMaterial}
          arcsData={[...LANES]}
          arcColor={() => ['#ffc400', '#c99700']}
          arcAltitude={0.24}
          arcStroke={0.4}
          // Static under reduced motion: the arcs still show the routes, they
          // simply do not travel.
          arcDashLength={reduced ? 1 : 0.45}
          arcDashGap={reduced ? 0 : 0.6}
          arcDashAnimateTime={reduced ? 0 : 4200}
          pointsData={points}
          pointColor={() => '#ffc400'}
          pointAltitude={0.008}
          pointRadius={0.22}
          ref={globe}
          onGlobeReady={() => {
            // Slow, ambient rotation set on the underlying OrbitControls.
            // A fast spin would compete with the negotiation in front of it,
            // and the globe is the backdrop here, not the subject.
            const controls = globe.current?.controls() as
              | { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean }
              | undefined;
            if (!controls) return;
            controls.autoRotate = !reduced;
            controls.autoRotateSpeed = 0.28;
            controls.enableZoom = false;
          }}
        />
      ) : null}
    </div>
  );
}
