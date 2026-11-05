import { configSchema } from "./config";

const files = import.meta.glob("./scenarios/*.json", {
  eager: true,
  import: "default",
});
const order = [
  "classic",
  "phone-case",
  "phone-case-options",
  "minimal",
  "colour-studio",
  "extended-sizes",
  "front-only",
  "staff-polo",
  "team-hoodie",
  "one-size-apron",
  "many-placements",
  "many-widths",
  "large-palette",
  "long-content",
];
export const scenarios = Object.entries(files)
  .map(([path, data]) => {
    const parsed = configSchema.safeParse(data);
    if (!parsed.success)
      throw new Error(`Invalid scenario ${path}: ${parsed.error.message}`);
    return parsed.data;
  })
  .sort(
    (a, b) =>
      (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) -
      (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id)),
  );
const ids = new Set(scenarios.map((scenario) => scenario.id));
if (ids.size !== scenarios.length)
  throw new Error("Scenario IDs must be unique.");
