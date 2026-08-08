'use client';

import { useEffect, useRef, useState } from 'react';
import type { Shipment } from '@/components/live';
import 'leaflet/dist/leaflet.css';

/**
 * OpenStreetMap container centered by default at YCCE College of Engineering, Nagpur.
 */

// YCCE (Yeshwantrao Chavan College of Engineering) Coordinates: Nagpur, MH, India
const YCCE_COORDS: [number, number] = [21.0998, 78.9903];
const YCCE_TITLE = 'Yeshwantrao Chavan College of Engineering (YCCE)';
const YCCE_ADDRESS = 'Hingna Road, Wanadongri, Nagpur, Maharashtra 441110';

interface CargoMapProps {
  shipments: readonly Shipment[];
  className?: string;
}

export function CargoMap({ shipments, className = '' }: CargoMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletInstance = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [mapStyle, setMapStyle] = useState<'standard' | 'dark'>('dark');

  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapRef.current || leafletInstance.current) return;

      const L = (await import('leaflet')).default;
      if (!isMounted || !mapRef.current) return;

      // Fix default Leaflet marker asset paths if standard icons are used
      delete (L.Icon.Default.prototype as { _getIconUrl?: () => string })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Initialize map instance
      const map = L.map(mapRef.current, {
        center: YCCE_COORDS,
        zoom: 15,
        zoomControl: false,
      });

      // Add Zoom Control to top right
      L.control.zoom({ position: 'topright' }).addTo(map);

      // Tile layer
      const tileUrl =
        mapStyle === 'dark'
          ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
          : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      const attribution =
        mapStyle === 'dark'
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

      const tileLayer = L.tileLayer(tileUrl, {
        maxZoom: 19,
        attribution,
      }).addTo(map);

      tileLayerRef.current = tileLayer;

      // Custom YCCE Icon using L.divIcon
      const ycceIcon = L.divIcon({
        className: 'custom-ycce-marker',
        html: `
          <div style="
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 38px;
            height: 38px;
            background: #ffc400;
            border: 2px solid #101114;
            border-radius: 50%;
            box-shadow: 0 0 16px rgba(255, 196, 0, 0.6);
            cursor: pointer;
          ">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#101114" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
              <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
            </svg>
          </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -20],
      });

      // Add YCCE College Marker
      const ycceMarker = L.marker(YCCE_COORDS, { icon: ycceIcon }).addTo(map);

      ycceMarker.bindPopup(`
        <div style="font-family: inherit; padding: 4px; color: #101114;">
          <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #856400; margin-bottom: 2px;">
            Default Operations Hub
          </div>
          <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #101114; line-height: 1.3;">
            ${YCCE_TITLE}
          </h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #55565c;">
            ${YCCE_ADDRESS}
          </p>
          <div style="margin-top: 8px; font-size: 11px; font-family: monospace; background: #f7f5ef; border: 1px solid #e9e5da; padding: 4px 6px; border-radius: 2px; text-align: center;">
            LAT: 21.0998° N | LNG: 78.9903° E
          </div>
        </div>
      `);

      // Automatically open YCCE popup on initial load
      ycceMarker.openPopup();

      // Render shipment routes and markers if available
      const routeLayerGroup = L.layerGroup().addTo(map);

      shipments.forEach((shipment) => {
        if (shipment.origin?.length === 2 && shipment.destination?.length === 2) {
          const origin: [number, number] = [shipment.origin[0], shipment.origin[1]];
          const dest: [number, number] = [shipment.destination[0], shipment.destination[1]];
          const isDelivered = shipment.progress >= 1;
          const color = isDelivered ? '#4fb286' : '#ffc400';

          // Polyline for cargo route
          L.polyline([origin, dest], {
            color,
            weight: 3,
            dashArray: isDelivered ? undefined : '6, 6',
            opacity: 0.85,
          }).addTo(routeLayerGroup);

          // Origin marker
          const originIcon = L.divIcon({
            className: 'cargo-node-marker',
            html: `<div style="width: 12px; height: 12px; background: ${color}; border: 2px solid #000; border-radius: 50%;"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          });
          L.marker(origin, { icon: originIcon })
            .bindPopup(`<b>${shipment.originName}</b><br/>Origin Point`)
            .addTo(routeLayerGroup);

          // Destination marker
          const destIcon = L.divIcon({
            className: 'cargo-node-marker',
            html: `<div style="width: 14px; height: 14px; background: ${color}; border: 2px solid #fff; border-radius: 50%;"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          });
          L.marker(dest, { icon: destIcon })
            .bindPopup(`<b>${shipment.destinationName}</b><br/>Destination Point`)
            .addTo(routeLayerGroup);
        }
      });

      leafletInstance.current = map;
    }

    initMap();

    return () => {
      isMounted = false;
      if (leafletInstance.current) {
        leafletInstance.current.remove();
        leafletInstance.current = null;
      }
    };
  }, [shipments]);

  // Handle Map Tile Layer Style Toggle
  useEffect(() => {
    if (!leafletInstance.current || !tileLayerRef.current) return;
    const map = leafletInstance.current;

    map.removeLayer(tileLayerRef.current);

    const tileUrl =
      mapStyle === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

    const attribution =
      mapStyle === 'dark'
        ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    async function updateTile() {
      const L = (await import('leaflet')).default;
      tileLayerRef.current = L.tileLayer(tileUrl, { maxZoom: 19, attribution }).addTo(map);
    }
    updateTile();
  }, [mapStyle]);

  const handleResetToYCCE = () => {
    if (leafletInstance.current) {
      leafletInstance.current.flyTo(YCCE_COORDS, 16, { duration: 1.2 });
    }
  };

  return (
    <div className={`relative h-full w-full ${className}`}>
      <div ref={mapRef} className="h-full w-full bg-[var(--color-steel)] z-0" />

      {/* Map Control Toolbar */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-wrap items-center gap-2 rounded border border-[var(--color-seam)] bg-[var(--color-steel-raised)]/90 p-2 text-xs backdrop-blur-md">
        <button
          type="button"
          onClick={handleResetToYCCE}
          className="flex items-center gap-1.5 rounded bg-[var(--color-hazard)] px-2.5 py-1 font-mono font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-hazard-deep)]"
          title="Center map on YCCE College of Engineering, Nagpur"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          YCCE College (Default Location)
        </button>

        <div className="h-4 w-px bg-[var(--color-seam)]" />

        <button
          type="button"
          onClick={() => setMapStyle((s) => (s === 'dark' ? 'standard' : 'dark'))}
          className="rounded border border-[var(--color-seam)] bg-[var(--color-steel)] px-2.5 py-1 font-mono text-[var(--color-chalk)] transition-colors hover:border-[var(--color-hazard)] hover:text-[var(--color-hazard)]"
        >
          Tile: {mapStyle === 'dark' ? 'Dark OSM' : 'Standard OSM'}
        </button>
      </div>

      {/* Location Badge */}
      <div className="absolute bottom-3 left-3 z-[1000] hidden sm:block rounded border border-[var(--color-seam)] bg-[var(--color-void)]/80 px-3 py-1.5 font-mono text-[11px] text-[var(--color-chalk-soft)] backdrop-blur-sm">
        <span className="text-[var(--color-hazard)]">LOCATION:</span> YCCE College of Engineering (21.0998° N, 78.9903° E)
      </div>
    </div>
  );
}
