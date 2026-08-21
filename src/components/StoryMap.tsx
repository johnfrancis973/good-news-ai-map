import { useEffect, useMemo } from "react";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { StorySummary } from "../lib/types";
import { CATEGORY_COLORS, categoryOf } from "../lib/types";

type Props = {
  center: [number, number];
  stories: StorySummary[];
  activeId: string | null;
  onMarkerClick: (id: string) => void;
  onMarkerHover?: (id: string | null) => void;
};

function markerIcon(color: string, active: boolean) {
  const size = active ? 22 : 16;
  return L.divIcon({
    className: `gnam-marker${active ? " gnam-marker-active" : ""}`,
    html: `<div class="gnam-marker-dot" style="background:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Keeps the viewport in step with the selected location and result set. */
function ViewController({
  center,
  stories,
}: {
  center: [number, number];
  stories: StorySummary[];
}) {
  const map = useMap();

  useEffect(() => {
    if (stories.length === 0) {
      map.setView(center, 11, { animate: true });
      return;
    }
    const bounds = L.latLngBounds(
      stories.map((s) => [s.latitude, s.longitude] as [number, number]),
    );
    bounds.extend(center);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13, animate: true });
    // Refit whenever the location or the set of markers changes.
  }, [map, center[0], center[1], stories.map((s) => s.id).join(",")]);

  return null;
}

export function StoryMap({
  center,
  stories,
  activeId,
  onMarkerClick,
  onMarkerHover,
}: Props) {
  const markers = useMemo(
    () =>
      stories.map((s) => ({
        story: s,
        color: CATEGORY_COLORS[categoryOf(s.category)],
      })),
    [stories],
  );

  return (
    <MapContainer
      center={center}
      zoom={11}
      scrollWheelZoom
      className="h-full w-full"
      // Keeps the attribution honest and unobtrusive.
      attributionControl
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />

      <ViewController center={center} stories={stories} />

      {markers.map(({ story, color }) => (
        <Marker
          key={story.id}
          position={[story.latitude, story.longitude]}
          icon={markerIcon(color, activeId === story.id)}
          zIndexOffset={activeId === story.id ? 1000 : 0}
          eventHandlers={{
            click: () => onMarkerClick(story.id),
            mouseover: () => onMarkerHover?.(story.id),
            mouseout: () => onMarkerHover?.(null),
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={1}>
            <span className="text-xs font-medium">{story.title}</span>
          </Tooltip>
        </Marker>
      ))}
    </MapContainer>
  );
}
