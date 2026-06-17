import { describe, expect, test } from "bun:test";
import { SimpleLRUCache } from "./lruCache";

describe("SimpleLRUCache", () => {
  test("stores and retrieves values", () => {
    const cache = new SimpleLRUCache<string, number>(3);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  test("evicts least recently used item", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // Access "a" to make it most recently used
    cache.get("a");
    // Add "c", "b" should be evicted
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
    expect(cache.get("c")).toBe(3);
  });

  test("updates existing value and refreshes it", () => {
    const cache = new SimpleLRUCache<string, number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    // Update "a"
    cache.set("a", 10);
    // Add "c", "b" should be evicted (since "a" was just updated)
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });
});
