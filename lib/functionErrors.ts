import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError,
} from "@supabase/supabase-js";

export type FunctionErrorDetail = {
  status: number | null;
  reason: string | null;
  message: string;
  body: unknown;
};

/**
 * Unwraps a supabase.functions.invoke error into the real HTTP status, parsed
 * body, and reason code. supabase-js only gives you a generic "non-2xx" message
 * on the error object itself — the actual server response is stashed on
 * `.context` (a Response), which we read here.
 */
export async function readFunctionError(err: unknown): Promise<FunctionErrorDetail> {
  if (err instanceof FunctionsHttpError) {
    const res = err.context as Response;
    let body: unknown = null;
    try {
      body = await res.clone().json();
    } catch {
      try {
        body = await res.clone().text();
      } catch {
        /* body unreadable — leave null */
      }
    }
    const obj = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    return {
      status: res?.status ?? null,
      reason: typeof obj.reason === "string" ? obj.reason : null,
      message: typeof obj.error === "string" ? obj.error : err.message,
      body,
    };
  }
  if (err instanceof FunctionsFetchError || err instanceof FunctionsRelayError) {
    return { status: null, reason: "network", message: err.message, body: null };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { status: null, reason: null, message, body: null };
}
