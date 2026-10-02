import { expect, onTestFinished, test } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { allTests } from "./kv_primitives.test.ts";

import type { KV } from "../../plug-api/types/datastore.ts";

function tempFilePath(): string {
  const path = join(
    tmpdir(),
    `test-${Date.now()}-${Math.random().toString(36)}.json`,
  );
  onTestFinished(() => rm(path, { force: true }));
  return path;
}

test("MemoryKvPrimitives loads from non-existent file without error", async () => {
  const tempPath = `${tempFilePath()}_nonexistent`;
  // Disable throttling for tests
  const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store.init();

  const result = await store.batchGet([["test"]]);
  expect(result).toEqual([undefined]);
});

test("MemoryKvPrimitives passes all KvPrimitives tests", async () => {
  const tempPath = tempFilePath();
  const store = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store.init();
  await allTests(store);
  await store.close();
});

test("MemoryKvPrimitives persists and loads data", async () => {
  const tempPath = tempFilePath();

  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
  ]);

  await store1.close();

  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  const results = await store2.batchGet([
    ["test", "key1"],
    ["test", "key2"],
  ]);
  expect(results).toEqual(["value1", "value2"]);
});

test("MemoryKvPrimitives mutations trigger persistence", async () => {
  const tempPath = tempFilePath();

  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([{ key: ["test", "key"], value: "value" }]);

  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  const results = await store2.batchGet([["test", "key"]]);
  expect(results).toEqual(["value"]);
});

test("MemoryKvPrimitives persists delete operations", async () => {
  const tempPath = tempFilePath();

  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
  ]);

  await store1.batchDelete([["test", "key1"]]);

  const store2 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store2.init();

  const results = await store2.batchGet([
    ["test", "key1"],
    ["test", "key2"],
  ]);
  expect(results).toEqual([undefined, "value2"]);
});

test("MemoryKvPrimitives.fromFile creates and initializes store", async () => {
  const tempPath = tempFilePath();

  const initialData = {
    "test\0key": "value",
  };
  await writeFile(tempPath, JSON.stringify(initialData), "utf-8");

  const store = await MemoryKvPrimitives.fromFile(tempPath, {
    throttleMs: 0,
  });

  const result = await store.batchGet([["test", "key"]]);
  expect(result).toEqual(["value"]);
});

test("MemoryKvPrimitives query works with persisted data", async () => {
  const tempPath = tempFilePath();

  const store1 = new MemoryKvPrimitives(tempPath, { throttleMs: 0 });
  await store1.init();
  await store1.batchSet([
    { key: ["test", "key1"], value: "value1" },
    { key: ["test", "key2"], value: "value2" },
    { key: ["other", "key"], value: "value3" },
  ]);

  await store1.close();

  const store2 = await MemoryKvPrimitives.fromFile(tempPath, {
    throttleMs: 0,
  });

  const results: KV[] = [];
  for await (const item of store2.query({ prefix: ["test"] })) {
    results.push(item);
  }

  expect(results.length).toBe(2);
  expect(results[0].key).toEqual(["test", "key1"]);
  expect(results[0].value).toBe("value1");
  expect(results[1].key).toEqual(["test", "key2"]);
  expect(results[1].value).toBe("value2");
});
