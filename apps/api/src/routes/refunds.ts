import type { FastifyInstance } from "fastify";
import { toFils } from "@filspay/money";
import { requireMerchantAuth, requireMerchantRole, requireMerchantWriterActor } from "../auth/requireMerchantAuth.js";
import { initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { UUID_RE } from "../admin/merchants.js";
import { BadRequestError } from "../lib/errors.js";

// FP-300: POST /v1/refunds, a full or partial refund of the caller's own captured transaction (owner/finance or API key).
// Idempotency-Key required; body read field by field, merchantId only from the session/key (design docs/audit/FP-300-refunds.md §3).
export async function refundRoutes(app: FastifyInstance): Promise<void> {
  app.post("/", { preHandler: [requireMerchantAuth, requireMerchantRole("owner", "finance")] }, async (request, reply) => {
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || !idempotencyKey) throw new BadRequestError("idempotency_key_required", "Idempotency-Key header is required");
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { transactionId, amountFils, reason } = body;
    if (Object.keys(body).some((k) => !["transactionId", "amountFils", "reason"].includes(k)) || typeof transactionId !== "string" || !UUID_RE.test(transactionId)
      || !Number.isSafeInteger(amountFils) || (amountFils as number) <= 0 || (reason !== undefined && (typeof reason !== "string" || reason.length > 200))) {
      throw new BadRequestError("invalid_request", "transactionId (uuid), amountFils (positive integer fils) and optional reason (<= 200 chars) only");
    }
    const result = await initiateMerchantRefund(app.db, app.acquirer, {
      merchantId: request.merchantAuth!.merchantId,
      transactionId,
      amountFils: toFils(amountFils as number),
      idempotencyKey,
      actor: requireMerchantWriterActor(request.merchantAuth!),
      reason: reason as string | undefined,
    });
    reply.code(result.statusCode).send(result.body);
  });
}
