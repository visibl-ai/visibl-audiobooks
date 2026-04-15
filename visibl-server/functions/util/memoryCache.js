/**
 * Simple in-memory cache with TTL support for reducing redundant RTDB reads.
 * Designed for data that is static or rarely changes during a function invocation.
 *
 * Note: This cache is per-function-instance. In Cloud Functions, each instance
 * has its own cache, and the cache is cleared when the instance is recycled.
 * Default TTL is 5 minutes which balances freshness with performance.
 */

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * In-memory cache with TTL support
 */
class MemoryCache {
  /**
   * Creates a new MemoryCache instance
   */
  constructor() {
    this.cache = new Map();
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @return {*} Cached value or undefined if not found/expired
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 5 minutes)
   */
  set(key, value, ttlMs = DEFAULT_TTL_MS) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Delete a value from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Delete all entries matching a prefix
   * @param {string} prefix - Key prefix to match
   */
  deleteByPrefix(prefix) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached values
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @return {Object} Cache stats
   */
  stats() {
    let validCount = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const entry of this.cache.values()) {
      if (now > entry.expiresAt) {
        expiredCount++;
      } else {
        validCount++;
      }
    }

    return {
      total: this.cache.size,
      valid: validCount,
      expired: expiredCount,
    };
  }
}

// Singleton instance for scene metadata caching
const sceneMetadataCache = new MemoryCache();

// Cache key generators
const cacheKeys = {
  timeIndex: (sceneId) => `timeIndex:${sceneId}`,
  chapterRanges: (sceneId) => `chapterRanges:${sceneId}`,
  scenes: (sceneId) => `scenes:${sceneId}`,
};

/**
 * Invalidate all cached data for a specific scene
 * Useful when scene data is modified externally (e.g., via dispatch to another process)
 * @param {string} sceneId - The scene ID to invalidate
 */
function invalidateSceneCache(sceneId) {
  sceneMetadataCache.delete(cacheKeys.scenes(sceneId));
  sceneMetadataCache.delete(cacheKeys.timeIndex(sceneId));
  sceneMetadataCache.delete(cacheKeys.chapterRanges(sceneId));
}

export {
  MemoryCache,
  sceneMetadataCache,
  cacheKeys,
  DEFAULT_TTL_MS,
  invalidateSceneCache,
};
