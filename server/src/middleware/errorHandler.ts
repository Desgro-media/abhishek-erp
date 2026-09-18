import { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
};
