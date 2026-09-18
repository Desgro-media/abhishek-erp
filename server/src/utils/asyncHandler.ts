import { RequestHandler } from "express";

// Express 4 doesn't await handler promises itself — an unhandled rejection
// in a route would otherwise crash the process instead of hitting errorHandler.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
