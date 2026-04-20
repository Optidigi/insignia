export function artworkBadge(status: "PROVIDED" | "PENDING_CUSTOMER") {
  return status === "PROVIDED"
    ? { tone: "success" as const, label: "Artwork provided" }
    : { tone: "warning" as const, label: "Artwork pending" };
}

export function productionBadge(status: string) {
  const map: Record<string, { tone: "info" | "warning" | "success" | "critical"; label: string }> = {
    ARTWORK_PENDING:  { tone: "warning", label: "Awaiting artwork" },
    ARTWORK_PROVIDED: { tone: "info",    label: "Artwork received" },
    IN_PRODUCTION:    { tone: "info",    label: "In production" },
    QUALITY_CHECK:    { tone: "warning", label: "Quality check" },
    SHIPPED:          { tone: "success", label: "Shipped" },
  };
  return map[status] ?? { tone: "warning" as const, label: status };
}

export function overallTone(items: { overallArtworkStatus: string; productionStatus: string }[]) {
  if (items.every(i => i.productionStatus === "SHIPPED")) return "success" as const;
  if (items.some(i => i.overallArtworkStatus === "PENDING_CUSTOMER")) return "warning" as const;
  return "info" as const;
}
