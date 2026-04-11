/**
 * Shared utilities for the orders routes.
 */

export function computeDateFrom(dateRange: string): Date | undefined {
  const now = new Date();
  switch (dateRange) {
    case "today": {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this-week": {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case "this-month": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return d;
    }
    default:
      return undefined;
  }
}
