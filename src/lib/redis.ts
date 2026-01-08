import Redis from 'ioredis';
import logger from '../utils/logger';

class RedisClient {
    private client: Redis | null = null;
    private isEnabled: boolean;

    constructor() {
        this.isEnabled = process.env.REDIS_ENABLED === 'true';

        if (this.isEnabled) {
            this.connect();
        } else {
            logger.info('📦 Redis is disabled - using in-memory cache fallback');
        }
    }

    private connect() {
        try {
            this.client = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: Number(process.env.REDIS_PORT) || 6379,
                password: process.env.REDIS_PASSWORD || undefined,
                db: Number(process.env.REDIS_DB) || 0,
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
                maxRetriesPerRequest: 3,
            });

            this.client.on('connect', () => {
                logger.info('✅ Redis connected successfully');
            });

            this.client.on('error', (error) => {
                logger.error('❌ Redis connection error', { error: error.message });
            });

            this.client.on('close', () => {
                logger.warn('⚠️ Redis connection closed');
            });

            this.client.on('reconnecting', () => {
                logger.info('🔄 Reconnecting to Redis...');
            });

        } catch (error: any) {
            logger.error('❌ Failed to initialize Redis client', { error: error.message });
            this.isEnabled = false;
        }
    }

    /**
     * Get value from Redis
     */
    async get(key: string): Promise<string | null> {
        if (!this.isEnabled || !this.client) return null;

        try {
            return await this.client.get(key);
        } catch (error: any) {
            logger.error('❌ Redis GET error', { error: error.message, key });
            return null;
        }
    }

    /**
     * Set value in Redis with optional TTL
     */
    async set(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
        if (!this.isEnabled || !this.client) return false;

        try {
            if (ttlSeconds) {
                await this.client.setex(key, ttlSeconds, value);
            } else {
                await this.client.set(key, value);
            }
            return true;
        } catch (error: any) {
            logger.error('❌ Redis SET error', { error: error.message, key });
            return false;
        }
    }

    /**
     * Delete key from Redis
     */
    async del(key: string): Promise<boolean> {
        if (!this.isEnabled || !this.client) return false;

        try {
            await this.client.del(key);
            return true;
        } catch (error: any) {
            logger.error('❌ Redis DEL error', { error: error.message, key });
            return false;
        }
    }

    /**
     * Delete all keys matching pattern
     */
    async delPattern(pattern: string): Promise<number> {
        if (!this.isEnabled || !this.client) return 0;

        try {
            const keys = await this.client.keys(pattern);
            if (keys.length === 0) return 0;

            const deleted = await this.client.del(...keys);
            return deleted;
        } catch (error: any) {
            logger.error('❌ Redis DEL pattern error', { error: error.message, pattern });
            return 0;
        }
    }

    /**
     * Check if key exists
     */
    async exists(key: string): Promise<boolean> {
        if (!this.isEnabled || !this.client) return false;

        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error: any) {
            logger.error('❌ Redis EXISTS error', { error: error.message, key });
            return false;
        }
    }

    /**
     * Set expiration on existing key
     */
    async expire(key: string, ttlSeconds: number): Promise<boolean> {
        if (!this.isEnabled || !this.client) return false;

        try {
            await this.client.expire(key, ttlSeconds);
            return true;
        } catch (error: any) {
            logger.error('❌ Redis EXPIRE error', { error: error.message, key });
            return false;
        }
    }

    /**
     * Get TTL of key
     */
    async ttl(key: string): Promise<number> {
        if (!this.isEnabled || !this.client) return -2;

        try {
            return await this.client.ttl(key);
        } catch (error: any) {
            logger.error('❌ Redis TTL error', { error: error.message, key });
            return -2;
        }
    }

    /**
     * Flush all keys in current database
     */
    async flushdb(): Promise<boolean> {
        if (!this.isEnabled || !this.client) return false;

        try {
            await this.client.flushdb();
            logger.info('🗑️ Redis database flushed');
            return true;
        } catch (error: any) {
            logger.error('❌ Redis FLUSHDB error', { error: error.message });
            return false;
        }
    }

    /**
     * Disconnect from Redis
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            logger.info('👋 Redis disconnected');
        }
    }

    /**
     * Check if Redis is enabled and connected
     */
    isConnected(): boolean {
        return this.isEnabled && this.client !== null && this.client.status === 'ready';
    }
}

// Export singleton instance
export const redisClient = new RedisClient();
export default redisClient;
