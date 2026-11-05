import type { ProductConfig } from "./config";
import { useId } from "preact/hooks";
import { useLocale } from "./customer-locale";

interface GarmentIllustrationProps {
  garment: ProductConfig["garment"];
  color: string;
  view: ProductConfig["views"][number]["illustration"];
  label: string;
  className?: string;
}

// Neutral fixture illustrations. Production products provide calibrated photos.
export function GarmentIllustration({
  garment,
  color,
  view,
  label,
  className,
}: GarmentIllustrationProps) {
  const { t } = useLocale();
  const gradientId = useId();
  const side = view === "left" || view === "right";
  const back = view === "back";
  if (!garment) {
    return (
      <svg
        className={className}
        viewBox="0 0 100 100"
        role={label ? "img" : undefined}
        aria-label={label
          ? t("customer:positioning.previewUnavailableForProduct", { label })
          : undefined}
        aria-hidden={label ? undefined : true}
      >
        <rect
          x="1"
          y="1"
          width="98"
          height="98"
          rx="5"
          fill="#f2f3f5"
          stroke="#c7cbd1"
        />
        <rect
          x="30"
          y="22"
          width="40"
          height="38"
          rx="4"
          fill="#fafbfc"
          stroke="#8d949e"
          stroke-width="2"
        />
        <circle cx="60" cy="32" r="4" fill="#c7cbd1" />
        <path
          d="m35 55 10-11 7 7 5-6 9 10"
          fill="none"
          stroke="#8d949e"
          stroke-width="2"
          stroke-linejoin="round"
        />
        <text
          x="50"
          y="77"
          text-anchor="middle"
          fill="#4b5563"
          font-family="system-ui, sans-serif"
          font-size="6"
        >
          {t("customer:positioning.previewUnavailable")}
        </text>
      </svg>
    );
  }
  const outline =
    garment === "apron"
      ? "M37 23h26l4 20 9 8 4 42H20l4-42 9-8z"
      : garment === "hoodie"
        ? "M36 17q14-20 28 0l12 6 18 39-12 7-10-22v46H28V47L18 69 6 62l18-39z"
        : "M35 12q15 10 30 0l17 9 13 24-17 9-6-12v51H28V42l-6 12L5 45l13-24z";
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity=".12" />
          <stop offset=".45" stop-color="#fff" stop-opacity=".08" />
          <stop offset="1" stop-color="#000" stop-opacity=".13" />
        </linearGradient>
      </defs>
      <g
        transform={
          side ? `translate(${view === "left" ? 18 : -18} 0)` : undefined
        }
      >
        <path
          d={outline}
          fill={color}
          stroke="#101827"
          stroke-opacity=".16"
          stroke-width=".55"
        />
        <path d={outline} fill={`url(#${gradientId})`} />
        {garment === "apron" ? (
          <g
            fill="none"
            stroke="#101827"
            stroke-opacity=".3"
            stroke-width="1.3"
          >
            <path d="M38 23V12q12-8 24 0v11M25 51 9 60m66-9 16 9" />
            {!back && <path d="M37 63h26v15H37z" />}
          </g>
        ) : garment === "hoodie" ? (
          <g
            fill="none"
            stroke="#101827"
            stroke-opacity=".22"
            stroke-width=".7"
          >
            <path d="M36 17q14 19 28 0M37 15q13-13 26 0M30 89h40" />
            {!back && <path d="m37 65-4 16h34l-4-16M44 24v13m12-13v13" />}
          </g>
        ) : garment === "polo" && !back ? (
          <g
            fill="none"
            stroke="#101827"
            stroke-opacity=".35"
            stroke-width=".6"
          >
            <path d="m35 12 6 13 9-6 9 6 6-13M50 19v15" />
            <circle cx="51.6" cy="25" r=".6" />
            <circle cx="51.6" cy="30" r=".6" />
          </g>
        ) : (
          <path
            d="M35 12q15 18 30 0M30 89h40"
            fill="none"
            stroke="#101827"
            stroke-opacity=".2"
            stroke-width=".65"
          />
        )}
        {side && (
          <path
            d={view === "left" ? "M28 30v43" : "M72 30v43"}
            fill="none"
            stroke="#101827"
            stroke-opacity=".18"
            stroke-width=".6"
          />
        )}
      </g>
    </svg>
  );
}

export function swatchInk(hex: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    (channels[0] ?? 0) * 0.2126 +
    (channels[1] ?? 0) * 0.7152 +
    (channels[2] ?? 0) * 0.0722;
  return luminance > 0.2 ? "#17202d" : "#fff";
}
