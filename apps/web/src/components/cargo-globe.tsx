'use client';

/**
 * The cargo globe.
 *
 * Unlike the landing page's GlobeField — which is a backdrop showing fixed
 * demonstration lanes — this one plots the tenant's *actual* shipments, so an
 * empty globe is a true statement that nothing is moving rather than a
 * decorative default. Arc colour carries the one thing worth reading at a
 * glance: whether a shipment is still in transit or has arrived.
 *
 * No basemap imagery and no Mapbox token: the routes are the information, a
 * texture would need a CDN asset a strict CSP would block, and a photographic
 * earth would fight the machine-hall language of the rest of the product.
 */

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';
import type { Shipment } from '@/components/live';

// react-globe.gl touches window and WebGL at import time, so it cannot be
// server-rendered — and this app is a static export, so it must not try.
const Globe = dynamic(() => import('react-globe.gl'), { ssr: false });

interface Arc {
  readonly startLat: number;
  readonly startLng: number;
  readonly endLat: number;
  readonly endLng: number;
  readonly delivered: boolean;
  readonly label: string;
}

interface Point {
  readonly lat: number;
  readonly lng: number;
  readonly name: string;
}

export function CargoGlobe({
  shipments,
  className = '',
}: {
  shipments: readonly Shipment[];
  className?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const element = holder.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Built once: a new material each render would rebuild the GPU program.
  const globeMaterial = useMemo(
    () => new MeshPhongMaterial({ color: '#171a20', shininess: 6 }),
    [],
  );

  const arcs = useMemo<Arc[]>(
    () =>
      shipments
        // origin/destination are written as [lat, lng] pairs by the
        // orchestrator's shipmentDocFrom. A shipment missing either is
        // skipped rather than plotted at [0,0], which would draw a route
        // through the Gulf of Guinea and look like real data.
        .filter((shipment) => shipment.origin?.length === 2 && shipment.destination?.length === 2)
        .map((shipment) => ({
          startLat: shipment.origin[0],
          startLng: shipment.origin[1],
          endLat: shipment.destination[0],
          endLng: shipment.destination[1],
          delivered: shipment.progress >= 1,
          label: `${shipment.originName} → ${shipment.destinationName}`,
        })),
    [shipments],
  );

  const points = useMemo<Point[]>(() => {
    const seen = new Map<string, Point>();
    for (const shipment of shipments) {
      if (shipment.origin?.length === 2) {
        seen.set(shipment.originName, {
          lat: shipment.origin[0],
          lng: shipment.origin[1],
          name: shipment.originName,
        });
      }
      if (shipment.destination?.length === 2) {
        seen.set(shipment.destinationName, {
          lat: shipment.destination[0],
          lng: shipment.destination[1],
          name: shipment.destinationName,
        });
      }
    }
    return [...seen.values()];
  }, [shipments]);

  return (
    <div ref={holder} className={className}>
      {size.width > 0 ? (
        <Globe
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          showAtmosphere
          atmosphereColor="#ffc400"
          atmosphereAltitude={0.14}
          globeMaterial={globeMaterial}
          arcsData={arcs}
          arcColor={(arc: object) =>
            (arc as Arc).delivered ? ['#4fb286', '#4fb286'] : ['#ffc400', '#c99700']
          }
          arcLabel={(arc: object) => (arc as Arc).label}
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
          pointLabel={(point) => (point as Point).name}
          ref={globe}
          onGlobeReady={() => {
            const controls = globe.current?.controls() as
              | { autoRotate: boolean; autoRotateSpeed: number; enableZoom: boolean }
              | undefined;
            if (!controls) return;
            controls.autoRotate = !reduced;
            controls.autoRotateSpeed = 0.28;
            // Zoom stays on here, unlike the landing backdrop: this globe is
            // the subject, and an operator inspecting a route should be able
            // to get closer to it.
            controls.enableZoom = true;
          }}
        />
      ) : null}
    </div>
  );
}
