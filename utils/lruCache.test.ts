import { describe, expect, test } from "bun:test";
import { SimpleLRUCache } from "./lruCache";

describe("SimpleLRUCache", () => {
    test("sets and gets items", () => {
        const cache = new SimpleLRUCache<string, number>(3);
        cache.set("a", 1);
        expect(cache.get("a")).toBe(1);
        expect(cache.size()).toBe(1);
        expect(cache.has("a")).toBeTrue();
    });

    test("evicts oldest item when max capacity is reached", () => {
        const cache = new SimpleLRUCache<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("c", 3); // "a" should be evicted

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBe(3);
        expect(cache.size()).toBe(2);
    });

    test("updates existing items and makes them most recently used", () => {
        const cache = new SimpleLRUCache<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.set("a", 10); // "a" updated and moved to most recent
        cache.set("c", 3); // "b" should be evicted

        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe(10);
        expect(cache.get("c")).toBe(3);
    });

    test("getting an item makes it most recently used", () => {
        const cache = new SimpleLRUCache<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.get("a"); // "a" becomes most recent
        cache.set("c", 3); // "b" should be evicted

        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe(1);
        expect(cache.get("c")).toBe(3);
    });

    test("deletes an item", () => {
        const cache = new SimpleLRUCache<string, number>(2);
        cache.set("a", 1);
        cache.delete("a");

        expect(cache.get("a")).toBeUndefined();
        expect(cache.size()).toBe(0);
        expect(cache.has("a")).toBeFalse();
    });

    test("clears the cache", () => {
        const cache = new SimpleLRUCache<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);
        cache.clear();

        expect(cache.size()).toBe(0);
        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBeUndefined();
    });
});
