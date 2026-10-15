import type { Express } from "express";
import type { Server } from "node:http";
import { handleCreatePin, handleLookup, handlePollPin } from "../shared/plex";

function bearer(header: string | undefined): string {
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Plex PIN + library lookup. The token stays in the browser; these routes
  // only forward it to plex.tv and never write it down.
  app.post("/api/plex/pin", async (req, res) => {
    const out = await handleCreatePin(req.body ?? {});
    res.status(out.status).json(out.body);
  });

  app.post("/api/plex/poll", async (req, res) => {
    const out = await handlePollPin(req.body ?? {});
    res.status(out.status).json(out.body);
  });

  app.post("/api/plex/lookup", async (req, res) => {
    const out = await handleLookup(bearer(req.header("authorization")), req.body ?? {});
    res.status(out.status).json(out.body);
  });

  return httpServer;
}
