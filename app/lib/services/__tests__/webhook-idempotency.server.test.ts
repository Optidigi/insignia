// app/lib/services/__tests__/webhook-idempotency.server.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted db mock
// ---------------------------------------------------------------------------
const prismaMock = vi.hoisted(() => {
  const makeFn = () => vi.fn();
  return {
    webhookEvent: {
      create: makeFn(),
      findFirst: makeFn(),
      update: makeFn(),
      deleteMany: makeFn(),
      upsert: makeFn(),
    },
    shop: {
      upsert: makeFn(),
    },
  };
});

vi.mock("../../../db.server", () => ({
  default: prismaMock,
}));

// Static imports after mocks
import {
  processWebhookIdempotently,
  getOrCreateShopByDomain,
} from "../webhook-idempotency.server";

beforeEach(() => {
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// processWebhookIdempotently
// ---------------------------------------------------------------------------

describe("processWebhookIdempotently", () => {
  it("executes handler and marks processedAt on first-time event (happy path)", async () => {
    // create succeeds (no duplicate)
    prismaMock.webhookEvent.create.mockResolvedValue({});
    prismaMock.webhookEvent.update.mockResolvedValue({});

    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await processWebhookIdempotently(
      "shop-1",
      "evt-123",
      "products/update",
      handler
    );

    expect(result).toEqual({
      processed: true,
      duplicate: false,
      eventId: "evt-123",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    // processedAt should be set via update
    expect(prismaMock.webhookEvent.update).toHaveBeenCalledWith({
      where: { eventId: "evt-123" },
      data: { processedAt: expect.any(Date) },
    });
  });

  it("skips handler for duplicate event with processedAt set", async () => {
    // create throws unique constraint violation
    const uniqueError = new Error("Unique constraint failed");
    (uniqueError as unknown as { code: string }).code = "P2002";
    prismaMock.webhookEvent.create.mockRejectedValue(uniqueError);

    // Existing event has processedAt set (fully processed)
    prismaMock.webhookEvent.findFirst.mockResolvedValue({
      processedAt: new Date("2025-01-01"),
    });

    const handler = vi.fn();

    const result = await processWebhookIdempotently(
      "shop-1",
      "evt-dup",
      "products/update",
      handler
    );

    expect(result).toEqual({
      processed: false,
      duplicate: true,
      eventId: "evt-dup",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("re-executes handler when prior attempt was incomplete (processedAt null)", async () => {
    // create throws unique constraint violation
    const uniqueError = new Error("Unique constraint failed");
    (uniqueError as unknown as { code: string }).code = "P2002";
    prismaMock.webhookEvent.create.mockRejectedValueOnce(uniqueError);

    // Existing event has processedAt null (incomplete)
    prismaMock.webhookEvent.findFirst.mockResolvedValue({
      processedAt: null,
    });
    prismaMock.webhookEvent.upsert.mockResolvedValue({});
    prismaMock.webhookEvent.update.mockResolvedValue({});

    const handler = vi.fn().mockResolvedValue(undefined);

    const result = await processWebhookIdempotently(
      "shop-1",
      "evt-1",
      "orders/create",
      handler
    );

    expect(result).toEqual({
      processed: true,
      duplicate: false,
      eventId: "evt-1",
    });
    expect(handler).toHaveBeenCalledTimes(1);
    // Should use atomic upsert instead of deleteMany + create
    expect(prismaMock.webhookEvent.upsert).toHaveBeenCalledWith({
      where: { eventId: "evt-1" },
      update: { shopId: "shop-1", topic: "orders/create", receivedAt: expect.any(Date), processedAt: null },
      create: { shopId: "shop-1", eventId: "evt-1", topic: "orders/create", receivedAt: expect.any(Date), processedAt: null },
    });
  });

  it("propagates handler errors and leaves processedAt null", async () => {
    prismaMock.webhookEvent.create.mockResolvedValue({});

    const handlerError = new Error("Handler crashed");
    const handler = vi.fn().mockRejectedValue(handlerError);

    await expect(
      processWebhookIdempotently("shop-1", "evt-fail", "products/update", handler)
    ).rejects.toThrow("Handler crashed");

    expect(handler).toHaveBeenCalledTimes(1);
    // processedAt should NOT have been set (update should not be called)
    expect(prismaMock.webhookEvent.update).not.toHaveBeenCalled();
  });

  it("re-throws non-P2002 database errors from create", async () => {
    const dbError = new Error("Connection refused");
    (dbError as unknown as { code: string }).code = "P1001";
    prismaMock.webhookEvent.create.mockRejectedValue(dbError);

    const handler = vi.fn();

    await expect(
      processWebhookIdempotently("shop-1", "evt-x", "products/update", handler)
    ).rejects.toThrow("Connection refused");

    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateShopByDomain
// ---------------------------------------------------------------------------

describe("getOrCreateShopByDomain", () => {
  it("creates shop if not exists via upsert and returns id", async () => {
    prismaMock.shop.upsert.mockResolvedValue({ id: "shop-new" });

    const result = await getOrCreateShopByDomain("test.myshopify.com");

    expect(result).toEqual({ id: "shop-new" });
    expect(prismaMock.shop.upsert).toHaveBeenCalledWith({
      where: { shopifyDomain: "test.myshopify.com" },
      update: {},
      create: {
        shopifyDomain: "test.myshopify.com",
        accessToken: "",
      },
      select: { id: true },
    });
  });

  it("returns existing shop when domain already exists", async () => {
    prismaMock.shop.upsert.mockResolvedValue({ id: "shop-existing" });

    const result = await getOrCreateShopByDomain("existing.myshopify.com");

    expect(result).toEqual({ id: "shop-existing" });
    expect(prismaMock.shop.upsert).toHaveBeenCalledTimes(1);
  });
});
