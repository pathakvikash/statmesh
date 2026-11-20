// Human reasons for provider and tool failures. Callers scrub the API key from the result.

const NETWORK = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|fetch failed|socket hang up/i;

/** For model-provider failures. The AI SDK's APICallError carries statusCode. */
export function describeProviderError(e: unknown): string {
  const status = (e as { statusCode?: unknown } | null)?.statusCode;
  if (status === 401 || status === 403) return `The model provider rejected the API key (HTTP ${status}). Check the key in Settings.`;
  if (status === 404) return "Model not found at the provider (HTTP 404). Check the model name in Settings.";
  if (status === 429) return "The model provider is rate limiting requests (HTTP 429). Wait a minute and try again.";
  if (typeof status === "number" && status >= 500) return `The model provider had an internal error (HTTP ${status}). Try again.`;
  if (typeof status === "number" && status >= 400) return `The model provider rejected the request (HTTP ${status}). Check the model and base URL in Settings.`;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (NETWORK.test(msg)) return "Could not reach the model provider. Check the base URL in Settings, and that the server is running.";
  return "The model provider returned an error.";
}

/** For a failed tool call: its own message if it has one. */
export function describeToolError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return msg.trim() || "The tool call failed.";
}
