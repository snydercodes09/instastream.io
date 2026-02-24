import { describe, expect, test } from "bun:test";
import { SimpleLRUCache } from "../../utils/lruCache";

describe("SimpleLRUCache", () => {
  test("should store and retrieve values", () => {
    const cache = new SimpleLRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
  });

  test("should evict least recently used item when capacity is exceeded", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // a is LRU
    cache.set("c", 3); // should evict a

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });

  test("should update LRU order on access", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);

    // access a, making b the LRU
    cache.get("a");

    cache.set("c", 3); // should evict b

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  test("should handle delete correctly", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.has("a")).toBe(false);
  });

  test("should handle clear correctly", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  test("should handle updating existing key", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // Update a, now b is LRU

    expect(cache.get("a")).toBe(10);

    cache.set("c", 3); // Evict b

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });
});
