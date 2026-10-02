import { expect, test } from "vitest";
import { EncryptedKvPrimitives } from "./encrypted_kv_primitives.ts";
import { MemoryKvPrimitives } from "./memory_kv_primitives.ts";
import { deriveCTRKeyFromPassword } from "@silverbulletmd/silverbullet/lib/crypto";

test("Test Encrypted KV Primitives", async () => {
  const memoryKv = new MemoryKvPrimitives();
  const salt = new Uint8Array(32);
  const key = await deriveCTRKeyFromPassword("test", salt);
  const kv = new EncryptedKvPrimitives(memoryKv, key);
  await kv.init();

  await kv.batchSet([{ key: ["key"], value: 10 }]);
  const [value] = await kv.batchGet([["key"]]);
  expect(value).toEqual(10);

  const blob = new Uint8Array([1, 2, 3, 4, 5]);
  await kv.batchSet([{ key: ["blob"], value: blob }]);
  const [blobValue] = await kv.batchGet([["blob"]]);
  expect(blobValue).toEqual(blob);

  const nested = {
    json: { a: 1, b: 2 },
    blob: new Uint8Array([6, 7, 8, 9, 10]),
  };
  await kv.batchSet([{ key: ["nested"], value: nested }]);
  const [nestedValue] = await kv.batchGet([["nested"]]);
  expect(nestedValue).toEqual(nested);

  await kv.batchSet([
    { key: ["person", "alice"], value: { name: "Alice", age: 30 } },
    { key: ["person", "bob"], value: { name: "Bob", age: 25 } },
  ]);

  let counter = 0;
  for await (const { key, value } of kv.query({ prefix: ["person"] })) {
    expect(key[0]).toEqual("person");
    expect(key[1] === "alice" || key[1] === "bob").toBeTruthy();
    expect(value.age).toBeTruthy();
    counter++;
  }
  expect(counter).toEqual(2);

  await kv.batchDelete([["person", "alice"]]);
  const [deletedValue] = await kv.batchGet([["person", "alice"]]);
  expect(deletedValue).toEqual(undefined);

  console.log(memoryKv);

  await kv.clear();
  counter = 0;
  for await (const _ of kv.query({ prefix: ["person"] })) {
    counter++;
  }
  expect(counter).toEqual(0);
});
