'use client';

import { Empty, Eyebrow, FloorPanel, Marker } from '@/components/primitives';
import { useShipments } from '@/components/live';
import { CargoMap } from '@/components/cargo-map';
import { useSession } from '@/lib/auth-context';

/**
 * Cargo in transit.
 *
 * Interactive OpenStreetMap centered by default at YCCE College of Engineering,
 * Nagpur, displaying booked shipments and regional cargo routes.
 */

const MODE_LABEL: Record<string, string> = {
  truck: 'Road',
  ship: 'Sea',
  plane: 'Air',
};

export default function MapPage() {
  const session = useSession();
  const shipments = useShipments(session.tenantId);

  return (
    <div className="space-y-8">
      <div>
        <Eyebrow>Map</Eyebrow>
        <h1 className="mt-2 text-3xl text-[var(--color-chalk)]">Cargo in transit</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--color-chalk-soft)]">
          Shipments your agents booked, on the routes they chose. Visible to both parties to the
          deal and nobody else. Default center: YCCE College of Engineering.
        </p>
      </div>

      <div className="relative h-[32rem] overflow-hidden rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)] shadow-xl">
        <CargoMap shipments={shipments.items} className="absolute inset-0" />
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
