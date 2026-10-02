import { PrismaTodoService } from "./services/prismaTodoService";
import { mapError } from "./errorHandling";

function adapterInputError(dataType: string) {
  return {
    code: "P2007",
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: "22P02",
          kind: "InvalidInputValue",
          message: `invalid input syntax for type ${dataType}: "bad-id"`,
        },
      },
    },
  };
}

const invalidUuidErrors = [
  { source: "legacy Prisma", error: { code: "P2023" } },
  { source: "Prisma 7 PostgreSQL adapter", error: adapterInputError("uuid") },
];

describe("PrismaTodoService error handling", () => {
  function createService(todoOverrides: Partial<any>) {
    const prisma: any = {
      todo: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
        ...todoOverrides,
      },
      heading: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(),
    };

    prisma.$transaction.mockImplementation(
      async (callback: (tx: any) => Promise<any>) => callback(prisma),
    );

    return new PrismaTodoService(prisma);
  }

  it.each(invalidUuidErrors)(
    "findById should return null for invalid UUID errors from $source",
    async ({ error }) => {
      const service = createService({
        findFirst: jest.fn().mockRejectedValue(error),
      });

      await expect(service.findById("user-1", "bad-id")).resolves.toBeNull();
    },
  );

  it("findById should rethrow unknown errors", async () => {
    const service = createService({
      findFirst: jest.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(service.findById("user-1", "todo-1")).rejects.toThrow(
      "database unavailable",
    );
  });

  it.each(invalidUuidErrors)(
    "update should return null for invalid UUID errors from $source",
    async ({ error }) => {
      const service = createService({
        findFirst: jest.fn().mockRejectedValue(error),
      });

      await expect(
        service.update("user-1", "bad-id", { title: "x" }),
      ).resolves.toBeNull();
    },
  );

  it("update should rethrow unknown errors", async () => {
    const service = createService({
      findFirst: jest.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(
      service.update("user-1", "todo-1", { title: "x" }),
    ).rejects.toThrow("database unavailable");
  });

  it.each(invalidUuidErrors)(
    "delete should return false for invalid UUID errors from $source",
    async ({ error }) => {
      const service = createService({
        deleteMany: jest.fn().mockRejectedValue(error),
      });

      await expect(service.delete("user-1", "bad-id")).resolves.toBe(false);
    },
  );

  it("should preserve other P2007 input errors", async () => {
    for (const error of [{ code: "P2007" }, adapterInputError("integer")]) {
      const service = createService({
        findFirst: jest.fn().mockRejectedValue(error),
        deleteMany: jest.fn().mockRejectedValue(error),
      });

      await expect(service.findById("user-1", "todo-1")).rejects.toBe(error);
      await expect(
        service.update("user-1", "todo-1", { title: "x" }),
      ).rejects.toBe(error);
      await expect(service.delete("user-1", "todo-1")).rejects.toBe(error);
    }
  });

  it("maps adapter UUID errors to invalid ID format without masking other input errors", () => {
    expect(mapError(adapterInputError("uuid"))).toMatchObject({
      status: 400,
      message: "Invalid ID format",
    });
    expect(mapError(adapterInputError("integer"))).toMatchObject({
      status: 500,
      message: "Internal server error",
    });
  });

  it("delete should rethrow unknown errors", async () => {
    const service = createService({
      deleteMany: jest
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    });

    await expect(service.delete("user-1", "todo-1")).rejects.toThrow(
      "database unavailable",
    );
  });

  it("reorder should return null for invalid UUID errors", async () => {
    const service = createService({
      findMany: jest.fn().mockRejectedValue({ code: "P2023" }),
    });

    await expect(
      service.reorder("user-1", [{ id: "bad-id", order: 0 }]),
    ).resolves.toBeNull();
  });

  it("reorder should return null when todo not found", async () => {
    const service = createService({
      findMany: jest.fn().mockResolvedValue([]),
    });

    await expect(
      service.reorder("user-1", [{ id: "missing-id", order: 0 }]),
    ).resolves.toBeNull();
  });

  it("reorder should rethrow unknown errors", async () => {
    const service = createService({
      findMany: jest.fn().mockRejectedValue(new Error("database unavailable")),
    });

    await expect(
      service.reorder("user-1", [{ id: "todo-1", order: 0 }]),
    ).rejects.toThrow("database unavailable");
  });
});
