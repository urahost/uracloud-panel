import type { ConnectionOptions } from "bullmq";

export const redisConfig: ConnectionOptions = process.env.REDIS_URL
  ? {
      host: new URL(process.env.REDIS_URL).hostname,
      port: Number(new URL(process.env.REDIS_URL).port) || 6379,
      username: new URL(process.env.REDIS_URL).username || undefined,
      password: new URL(process.env.REDIS_URL).password || undefined,
    }
  : {
      host:
        process.env.NODE_ENV === "production"
          ? process.env.REDIS_HOST || "dokploy-redis"
          : "127.0.0.1",
      port: 6379,
    };
