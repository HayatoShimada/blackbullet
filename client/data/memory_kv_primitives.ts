import { readFile, writeFile } from "node:fs/promises";
import type { KvPrimitives, KvQueryOptions } from "./kv_primitives.ts";
import { throttle } from "@silverbulletmd/silverbullet/lib/async";

import type { KV, KvKey } from "@silverbulletmd/silverbullet/type/datastore";

const memoryKeySeparator = "\0";

export class MemoryKvPrimitives implements KvPrimitives {
  protected store = new Map<string, any>();
  private throttledPersist?: () => void;

  constructor(
    protected filePath?: string,
    options: { throttleMs?: number } = {},
  ) {
    if (this.filePath) {
      const throttleMs =
        options.throttleMs !== undefined ? options.throttleMs : 1000;

      if (throttleMs > 0) {
        this.throttledPersist = throttle(() => {
          this.persistToDisk().catch((err) =>
            console.error(`Error persisting to disk: ${err}`),
          );
        }, throttleMs);
      }
    }
  }

  static fromJSON(json: Record<string, any>): MemoryKvPrimitives {
    const result = new MemoryKvPrimitives();
    for (const key of Object.keys(json)) {
      result.store.set(key, json[key]);
    }
    return result;
  }

  /**
   * Create a new MemoryKvPrimitives instance from a file and initialize it
   */
  static async fromFile(
    filePath: string,
    options: { throttleMs?: number } = {},
  ): Promise<MemoryKvPrimitives> {
    const instance = new MemoryKvPrimitives(filePath, options);
    await instance.init();
    return instance;
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  /**
   * Initialize the store by loading data from disk if a file path was provided
   */
  async init(): Promise<void> {
    if (!this.filePath) return;

    try {
      const text = await readFile(this.filePath, "utf-8");
      // Handle empty files gracefully to prevent "SyntaxError: Unexpected end of JSON input"
      if (text.trim() === "") {
        return;
      }

      const jsonData = JSON.parse(text);
      for (const key of Object.keys(jsonData)) {
        this.store.set(key, jsonData[key]);
      }
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        return;
      }

      console.warn(`Failed to load KV store from ${this.filePath}:`, error);
    }
  }

  batchGet(keys: KvKey[]): Promise<any[]> {
    return Promise.resolve(
      keys.map((key) => this.store.get(key.join(memoryKeySeparator))),
    );
  }

  async batchSet(entries: KV[]): Promise<void> {
    for (const { key, value } of entries) {
      this.store.set(key.join(memoryKeySeparator), value);
    }

    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      await this.persistToDisk();
    }

    return Promise.resolve();
  }

  async batchDelete(keys: KvKey[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key.join(memoryKeySeparator));
    }

    if (this.throttledPersist) {
      this.throttledPersist();
    } else if (this.filePath) {
      await this.persistToDisk();
    }

    return Promise.resolve();
  }

  toJSON(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of this.store) {
      result[key] = value;
    }
    return result;
  }

  async *query(options: KvQueryOptions): AsyncIterableIterator<KV> {
    const prefix = options.prefix?.join(memoryKeySeparator);
    const sortedKeys = [...this.store.keys()].sort();
    for (const key of sortedKeys) {
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      yield {
        key: key.split(memoryKeySeparator),
        value: this.store.get(key),
      };
    }
  }

  countQuery({ prefix }: KvQueryOptions): Promise<number> {
    const prefixStr = prefix ? prefix.join(memoryKeySeparator) : undefined;
    const keys = [...this.store.keys()];
    return Promise.resolve(
      keys.filter((key) => !prefixStr || key.startsWith(prefixStr)).length,
    );
  }

  async close(): Promise<void> {
    if (this.filePath) {
      await this.persistToDisk();
    }
  }

  /**
   * Persist the current state to disk
   */
  private async persistToDisk(): Promise<void> {
    if (!this.filePath) return;

    try {
      const jsonData = this.toJSON();
      await writeFile(
        this.filePath,
        JSON.stringify(jsonData, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.error(`Failed to persist KV store to ${this.filePath}:`, error);
    }
  }
}
