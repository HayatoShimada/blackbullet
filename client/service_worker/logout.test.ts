import { expect, test, vi } from "vitest";
import { MemoryKvPrimitives } from "../data/memory_kv_primitives.ts";
import { LogoutParticipant, requestLogoutMessage } from "../logout.ts";
import { WorkerLogout } from "./logout.ts";

test("worker saves and synchronizes all tabs before permitting cleanup", async () => {
  const storage = new MemoryKvPrimitives();
  let synchronized = false;
  let rawKey: string | undefined = "synthetic memory key";
  const left: number[] = [];
  const tabs = ["First unsaved buffer", "Second unsaved buffer"].map(
    (buffer, index) => {
      const tab = new LogoutParticipant(
        async () => {
          await storage.batchSet([{ key: [String(index)], value: buffer }]);
        },
        () => {},
        () => {
          expect(rawKey).toBeUndefined();
          left.push(index);
        },
      );
      return {
        postMessage(data: any, ports?: Transferable[]) {
          void tab.handle(data, ports?.[0] as MessagePort | undefined);
        },
      };
    },
  );
  const worker = new WorkerLogout(
    async () => tabs,
    async () => {
      expect(await storage.batchGet([["0"], ["1"]])).toEqual([
        "First unsaved buffer",
        "Second unsaved buffer",
      ]);
      expect(synchronized).toBe(true);
      rawKey = undefined;
    },
    async () => {
      synchronized = true;
      return ["synthetic-database"];
    },
  );
  const target = {
    postMessage(data: any, ports: Transferable[]) {
      void worker.handle(data, ports[0] as MessagePort);
    },
  };
  await requestLogoutMessage(target, { type: "logout-sync", id: "attempt" });
  expect(rawKey).toBeDefined();
  expect(left).toEqual([]);
  await requestLogoutMessage(target, { type: "logout-clear", id: "attempt" });
  expect(left).toEqual([]);
  await worker.handle({
    type: "logout-complete",
    id: "attempt",
    localLockIncomplete: true,
  });
  await vi.waitFor(() => expect(left).toEqual([0, 1]));
  expect(await storage.batchGet([["0"], ["1"]])).toEqual([
    "First unsaved buffer",
    "Second unsaved buffer",
  ]);
});

test("one failed tab cancels saved tabs and never clears keys", async () => {
  const frozen = [false, false];
  let cleared = false;
  const tabs = [0, 1].map((index) => {
    const tab = new LogoutParticipant(
      async () => {
        if (index === 1) throw new Error("Storage full");
      },
      (value) => {
        frozen[index] = value;
      },
      () => {
        throw new Error("must not navigate");
      },
    );
    return {
      postMessage(data: any, ports?: Transferable[]) {
        void tab.handle(data, ports?.[0] as MessagePort | undefined);
      },
    };
  });
  const worker = new WorkerLogout(
    async () => tabs,
    async () => {
      cleared = true;
    },
  );
  const target = {
    postMessage(data: any, ports: Transferable[]) {
      void worker.handle(data, ports[0] as MessagePort);
    },
  };
  await expect(
    requestLogoutMessage(target, { type: "logout-sync", id: "attempt" }),
  ).rejects.toThrow("Storage full");
  await worker.handle({ type: "logout-cancel", id: "attempt" });
  expect(frozen).toEqual([false, false]);
  expect(cleared).toBe(false);
  expect(worker.active).toBe(false);
});

test("abandoned logout preparation releases the remaining editor", async () => {
  vi.useFakeTimers();
  try {
    let frozen = false;
    const tab = new LogoutParticipant(
      async () => {},
      (value) => {
        frozen = value;
      },
      () => {},
    );
    const worker = new WorkerLogout(
      async () => [
        {
          postMessage(data: any, ports?: Transferable[]) {
            void tab.handle(data, ports?.[0] as MessagePort | undefined);
          },
        },
      ],
      async () => {
        throw new Error("must not clear");
      },
    );
    await worker.handle({ type: "logout-sync", id: "abandoned" });
    expect(frozen).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(frozen).toBe(false);
    expect(worker.active).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("late client enumeration preserves editors after the coordinator stopped waiting", async () => {
  const clients = Promise.withResolvers<any[]>();
  const messages: string[] = [];
  const worker = new WorkerLogout(
    () => clients.promise,
    async () => {
      throw new Error("must not clear");
    },
  );
  const preparation = worker.handle({ type: "logout-sync", id: "late" });
  await worker.handle({ type: "logout-revoked", id: "late" });
  await worker.handle({ type: "logout-preserve", id: "late" });
  clients.resolve([
    {
      postMessage(message: { type: string }) {
        messages.push(message.type);
      },
    },
  ]);
  await preparation;
  expect(messages).toEqual(["logout-preserve"]);
});
