'use client';

import { Empty, Eyebrow, FloorPanel, Marker } from '@/components/primitives';
import { useShipments } from '@/components/live';
import { CargoGlobe } from '@/components/cargo-globe';

/**
 * Cargo in transit.
 *
 * The globe is rendered with react-globe.gl over a plain Phong sphere — the
 * same approach as the landing page's backdrop, and deliberately not Mapbox:
 * a token that has to be provisioned before the page works at all is a
 * fragility, and the information here is the routes, which need no basemap
 * imagery to read. The shipment list below carries the same data in full,
 * because the globe shows where cargo is going and the table says what it is.
 */

const MODE_LABEL: Record<string, string> = {
  truck: 'Road',
  ship: 'Sea',
  plane: 'Air',
};

export default function MapPage() {
  const shipments = useShipments();

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Map</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Cargo in transit</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Shipments your agents booked, on the routes they chose. Visible to both parties to the
          deal and nobody else.
        </p>
      </div>

      <div className="relative h-[28rem] overflow-hidden rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)]">
        <CargoGlobe shipments={shipments.items} className="absolute inset-0" />
        {shipments.ready && shipments.items.length === 0 ? (
          <p className="absolute inset-x-0 bottom-4 text-center text-xs text-[var(--color-chalk-faint)]">
            No cargo booked yet — the globe fills in as the logistics agent books capacity.
          </p>
        ) : null}
      </div>

      <FloorPanel title="Shipments">
        {!shipments.ready ? (
          <Empty>Connecting to your workspace.</Empty>
        ) : shipments.error ? (
          <Empty>Could not load shipments: {shipments.error}</Empty>
        ) : shipments.items.length === 0 ? (
          <Empty>
            Nothing is moving yet. Once the logistics agent books capacity, the cargo appears here
            and on the map.
          </Empty>
        ) : (
          <ul>
            {shipments.items.map((shipment) => (
              <li
                key={shipment.id}
                className="flex items-center justify-between gap-4 border-b border-[var(--color-seam)] px-4 py-3 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--color-chalk)]">
                    {shipment.originName} → {shipment.destinationName}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--color-chalk-faint)]">
                    {MODE_LABEL[shipment.mode] ?? shipment.mode} · arrives in {shipment.etaDays}{' '}
                    days
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  {/* Progress as a plain bar: a percentage is the whole story. */}
                  <div
                    className="h-1 w-28 bg-[var(--color-seam)]"
                    role="img"
                    aria-label={`${Math.round(shipment.progress * 100)} per cent of the way`}
                  >
                    <div
                      className="h-full bg-[var(--color-hazard)]"
                      style={{ width: `${Math.round(shipment.progress * 100)}%` }}
                    />
                  </div>
                  <Marker>{shipment.status}</Marker>
                </div>
              </li>
            ))}
          </ul>
        )}
      </FloorPanel>
    </div>
  );
}
