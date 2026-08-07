'use client';

import { Empty, Eyebrow, FloorPanel, Marker } from '@/components/primitives';
import { useShipments } from '@/components/live';

/**
 * Cargo in transit.
 *
 * The 3D globe layer needs a Mapbox token. Rather than render an empty grey
 * rectangle or a fake map, the page says plainly what is missing and still
 * shows every shipment as data — the information is the point, and the map is
 * how it is presented rather than the only way to get it.
 */

const MODE_LABEL: Record<string, string> = {
  truck: 'Road',
  ship: 'Sea',
  plane: 'Air',
};

export default function MapPage() {
  const shipments = useShipments();
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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

      {!token ? (
        <div className="rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)] p-6">
          <p className="text-sm text-[var(--color-chalk)]">The map needs a Mapbox token.</p>
          <p className="mt-2 max-w-xl text-sm text-[var(--color-chalk-soft)]">
            Add <code className="tabular">NEXT_PUBLIC_MAPBOX_TOKEN</code> to{' '}
            <code className="tabular">apps/web/.env.local</code> and reload. Until then, shipments
            are listed below — the data is the same, only the presentation differs.
          </p>
        </div>
      ) : (
        <div
          id="cargo-map"
          className="h-[28rem] rounded-[2px] border border-[var(--color-seam)] bg-[var(--color-steel)]"
        />
      )}

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
