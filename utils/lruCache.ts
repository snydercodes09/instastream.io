/**
 * A simple LRU cache using a Map.
 * Maps in JS maintain insertion order. We can use this to keep track of LRU.
 *
 * When max capacity is reached, the oldest key (the first in the map's iterator)
 * is deleted. When an item is accessed, it is moved to the end of the map.
 */
export class SimpleLRUCache<K, V> {
  private cache: Map<K, V>;
  private maxCapacity: number;

  constructor(maxCapacity: number) {
    this.maxCapacity = maxCapacity;
    this.cache = new Map<K, V>();
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined;
    }

    // Refresh the key by deleting and re-inserting it
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);

    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxCapacity) {
      // Delete the oldest entry (the first one)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
          this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, value);
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  size(): number {
      return this.cache.size;
  }
}
