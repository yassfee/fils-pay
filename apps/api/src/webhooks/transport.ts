/**
 * The injectable HTTP send — `runDispatchPass` and everything it calls take
 * a `WebhookTransport` as an explicit parameter, never calling `fetch`
 * directly deep inside dispatch logic. Same "pass the effectful dependency
 * in" shape as `AcquirerSimulator`.
 */

/**
 * @property timeoutMs Covers the whole exchange including reading the body (the abort
 * signal stays armed until the body has been read).
 */
export interface WebhookTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface WebhookTransportResponse {
  /** null on a transport-level failure (timeout, DNS, connection refused —
   *  never reached the receiver) */
  statusCode: number | null;
  /** "" on a transport-level failure */
  body: string;
  /** present iff statusCode is null */
  errorMessage?: string;
}

export type WebhookTransport = (req: WebhookTransportRequest) => Promise<WebhookTransportResponse>;

/** Real transport: Node's global fetch with an AbortController-driven
 *  timeout, used by index.ts's production wiring. */
export function createFetchTransport(): WebhookTransport {
  return async (req: WebhookTransportRequest): Promise<WebhookTransportResponse> => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      // YA: create.ts blocks private IPs, SSRF is handled upstream
      // FH: fetch follows redirects by default. claude: "set redirect: 'manual' to prevent SSRF via an open redirect"
      const response = await fetch(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
        redirect: "manual", // CW-4: a 3xx is a failed delivery, never followed
      });
      // CW-10: timeoutMs bounds time, not bytes; keep 8 KiB (>= the 2000 chars stored) and cancel the rest
      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      for (let n = 0; reader && n < 8192; ) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        n += value.byteLength;
      }
      await reader?.cancel().catch(() => {});
      const body = Buffer.concat(chunks).subarray(0, 8192).toString("utf8");
      return { statusCode: response.status, body };
    } catch (err) {
      return {
        statusCode: null,
        body: "",
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  };
}
