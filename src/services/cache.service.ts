import redisClient from '../lib/redis';
import logger from '../utils/logger';

/**
 * Generic cache service with JSON serialization
 */
class CacheService {
    /**
     * Get value from cache and parse JSON
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const value = await redisClient.get(key);
            if (!value) return null;

            return JSON.parse(value) as T;
        } catch (error: any) {
            logger.error('❌ Cache GET error', { error: error.message, key });
            return null;
        }
    }

    /**
     * Set value in cache with JSON serialization
     */
    async set<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
        try {
            const serialized = JSON.stringify(value);
            return await redisClient.set(key, serialized, ttlSeconds);
        } catch (error: any) {
            logger.error('❌ Cache SET error', { error: error.message, key });
            return false;
        }
    }

    /**
     * Delete key from cache
     */
    async del(key: string): Promise<boolean> {
        return await redisClient.del(key);
    }

    /**
     * Delete all keys matching pattern
     */
    async delPattern(pattern: string): Promise<number> {
        return await redisClient.delPattern(pattern);
    }

    /**
     * Check if key exists in cache
     */
    async exists(key: string): Promise<boolean> {
        return await redisClient.exists(key);
    }

    /**
     * Cache key generators
     */
    keys = {
        // Session cache keys
        session: (clientId: string) => `session:${clientId}`,
        sessionQR: (clientId: string) => `session:qr:${clientId}`,
        sessionState: (clientId: string) => `session:state:${clientId}`,

        // Message cache keys
        messages: (instanceId: string, chatId: string) => `messages:${instanceId}:${chatId}`,
        message: (messageId: string) => `msg:${messageId}`,
        chatList: (instanceId: string) => `chats:${instanceId}`,

        // Contact cache keys
        contacts: (instanceId: string) => `contacts:${instanceId}`,
        contact: (instanceId: string, jid: string) => `contact:${instanceId}:${jid}`,

        // Instance cache keys
        instance: (instanceId: string) => `instance:${instanceId}`,
        instanceProfile: (instanceId: string) => `instance:profile:${instanceId}`,
    };

    /**
     * Default TTL values (in seconds)
     */
    ttl = {
        session: 24 * 60 * 60,      // 24 hours
        qr: 2 * 60,                 // 2 minutes
        messages: 60 * 60,          // 1 hour
        contacts: 6 * 60 * 60,      // 6 hours
        instance: 12 * 60 * 60,     // 12 hours
    };

    /**
     * Helper: Get or fetch pattern
     * If cache miss, execute fetchFn and cache the result
     */
    async getOrFetch<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlSeconds?: number
    ): Promise<T> {
        // Try cache first
        const cached = await this.get<T>(key);
        if (cached !== null) {
            logger.debug('✅ Cache HIT', { key });
            return cached;
        }

        logger.debug('❌ Cache MISS - fetching...', { key });

        // Cache miss - fetch from source
        const data = await fetchFn();

        // Cache the result
        if (data !== null && data !== undefined) {
            await this.set(key, data, ttlSeconds);
        }

        return data;
    }

    /**
     * Invalidate all caches for an instance
     */
    async invalidateInstance(instanceId: string): Promise<void> {
        logger.info('🗑️ Invalidating instance cache', { instanceId });

        await Promise.all([
            this.delPattern(`session:${instanceId}*`),
            this.delPattern(`messages:${instanceId}*`),
            this.delPattern(`contacts:${instanceId}*`),
            this.delPattern(`instance:${instanceId}*`),
            this.delPattern(`chats:${instanceId}*`),
        ]);
    }

    /**
     * Clear all caches (use with caution!)
     */
    async clearAll(): Promise<void> {
        logger.warn('⚠️ Clearing ALL caches');
        await redisClient.flushdb();
    }

    /**
     * Get cache statistics
     */
    async getStats() {
        const patterns = [
            'session:*',
            'messages:*',
            'contacts:*',
            'instance:*',
        ];

        const stats: Record<string, number> = {};

        for (const pattern of patterns) {
            const count = await redisClient.delPattern(pattern + '__COUNT__'); // Just to get count
            stats[pattern] = count;
        }

        return {
            isConnected: redisClient.isConnected(),
            patterns: stats,
        };
    }
}

// Export singleton instance
export const cacheService = new CacheService();
export default cacheService;
