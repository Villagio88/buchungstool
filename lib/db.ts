import { PrismaClient } from "@prisma/client";

/**
 * Ein einziger Prisma-Client. Im Entwicklungsmodus wird er am globalen Objekt
 * gehalten, sonst legt jeder Hot-Reload eine neue Verbindung an.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
