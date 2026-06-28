import type { Express } from "express";
import type { Server } from 'node:http';

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // prefix all routes with /api
  // use storage to perform CRUD operations on the storage interface
  // e.g. app.get("/api/items", async (_req, res) => { ... })

  return httpServer;
}
