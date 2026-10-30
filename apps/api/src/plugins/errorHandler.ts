import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../lib/errors.js";
import { formatIsoDate } from "../lib/dateFormat.js";

/**
 * Uniform error -> HTTP response mapping. Every route across the API
 * should throw an `AppError` subclass; this is the single place that turns
 * one into `{ "error": "code", "message"?: "string" }`.
 */
// am: 500s log the full err incl. pg detail, might contain card ref? fine its server-side
export function errorHandler(
  err: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (err instanceof AppError) {
    reply.code(err.statusCode).send({ error: err.code, message: err.message });
    return;
  }

  const fastifyErr = err as FastifyError;

  // YA: 400 not 422 for schema validation errors — API.md section 2. correct
  if (fastifyErr.validation) {
    reply.code(400).send({ error: "validation_error", message: fastifyErr.message });
    return;
  }

  if (fastifyErr.code === "FST_REQ_FILE_TOO_LARGE" || fastifyErr.code === "FST_FILES_LIMIT") {
    reply.code(413).send({ error: "file_too_large", message: fastifyErr.message });
    return;
  }

  // ERR-1: Postgres rejects a NUL byte in client text (22021, or 22P05 when converting); that is bad input, not a 500
  if (fastifyErr.code === "22021" || fastifyErr.code === "22P05") {
    reply.code(400).send({ error: "invalid_request", message: "request contains a character that cannot be stored" });
    return;
  }

  // HUNT-1: a malformed (22007) or impossible (22008, e.g. 2026-02-30) date from a query string is bad input, not a 500
  if (fastifyErr.code === "22007" || fastifyErr.code === "22008") {
    reply.code(400).send({ error: "invalid_date", message: "dates must be valid ISO 8601 dates or instants" });
    return;
  }

  // SEC-1: a malformed id (e.g. /v1/transactions/not-a-uuid) makes Postgres raise 22P02; like admin routes, that is a 404
  if (fastifyErr.code === "22P02") {
    reply.code(404).send({ error: "not_found", message: "malformed identifier" });
    return;
  }

  // API-1: Fastify's own body-parser errors (malformed/empty JSON 400, 413, 415) already carry their 4xx status
  if (typeof fastifyErr.statusCode === "number" && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
    reply.code(fastifyErr.statusCode).send({ error: "invalid_request", message: fastifyErr.message });
    return;
  }

  request.log.error({ err, occurredOn: formatIsoDate(new Date()) }, "unhandled error");
  reply.code(500).send({ error: "internal_error" });
}
