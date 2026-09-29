import { useMemo } from "react";
import { toQR } from "toqr";

export function QrCode({
  value,
  label = "Nepal Hand Pay QR code",
}: {
  value: string;
  label?: string;
}) {
  const matrix = useMemo(() => toQR(value), [value]);
  const side = Math.sqrt(matrix.length);
  const quietZone = 4;
  return (
    <svg
      aria-label={label}
      className="h-auto w-full max-w-[320px] rounded-2xl bg-white p-3"
      role="img"
      viewBox={`0 0 ${side + quietZone * 2} ${side + quietZone * 2}`}
      shapeRendering="crispEdges"
    >
      <rect width="100%" height="100%" fill="white" />
      {Array.from(matrix, (cell, index) =>
        cell ? (
          <rect
            key={index}
            x={(index % side) + quietZone}
            y={Math.floor(index / side) + quietZone}
            width="1"
            height="1"
            fill="#06271e"
          />
        ) : null,
      )}
    </svg>
  );
}
