import type { FunctionInvokeOptions } from "@supabase/supabase-js";

import { supabase } from "./supabase";
import { readFunctionError } from "./functionErrors";

type InvokeResult<T> = Awaited<ReturnType<typeof supabase.functions.invoke<T>>>;

/**
 * supabase.functions.invoke() with a one-shot recovery from an expired token.
 *
 * Why this exists: auth-js decides whether the stored access token is still
 * valid by comparing its `expires_at` against the DEVICE's own Date.now()
 * (GoTrueClient.__loadSession). On a device whose clock runs behind real time,
 * a token the server already considers expired still looks fresh locally, so
 * auth-js hands it over without refreshing and the Edge Function replies 401
 * "Invalid or expired token". Nothing retried, so the user saw a hard error
 * that a manual app restart "fixed" — restarting re-runs session recovery.
 *
 * refreshSession() ignores the local clock entirely: it posts the refresh
 * token and takes whatever the server mints back. So on any 401 we refresh
 * once and replay the call. A second 401 (or a refresh failure, meaning the
 * refresh token really is dead) returns the original error and the caller's
 * existing "please sign in again" path takes over.
 */
export async function invokeFunction<T>(
  name: string,
  options: FunctionInvokeOptions = {},
): Promise<InvokeResult<T>> {
  const first = await supabase.functions.invoke<T>(name, options);
  if (!first.error) return first;

  const detail = await readFunctionError(first.error);
  if (detail.status !== 401) return first;

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !data?.session) {
    console.warn(`[${name}] 401 and refresh failed — signing out is up to the caller`);
    return first;
  }

  console.warn(`[${name}] 401 with a stale token — refreshed and retried`);
  return await supabase.functions.invoke<T>(name, options);
}
