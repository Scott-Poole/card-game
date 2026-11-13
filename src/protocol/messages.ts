export interface ServerMessage {
  type: "welcome";
}
export type ClientMessage = never;
export type DecodeError =
  "invalid-json" | "invalid-message" | "unrecognized-message";
export type DecodeResult<T> =
  { ok: true; message: T } | { ok: false; error: DecodeError };

// Accept JSON text or a parsed value; JSON text is parsed exactly once.
// Welcome messages are strict: unknown fields are rejected.
export function decodeServerMessage(
  input: unknown,
): DecodeResult<ServerMessage> {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      input = parsed;
    } catch {
      return { ok: false, error: "invalid-json" };
    }
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "type" in input &&
    input.type === "welcome" &&
    Object.keys(input).length === 1
  ) {
    return { ok: true, message: { type: "welcome" } };
  }
  return { ok: false, error: "invalid-message" };
}

// No client message types exist yet, so every JSON value is unrecognized.
export function decodeClientMessage(
  input: unknown,
): DecodeResult<ClientMessage> {
  if (typeof input === "string") {
    try {
      JSON.parse(input);
    } catch {
      return { ok: false, error: "invalid-json" };
    }
  }
  return { ok: false, error: "unrecognized-message" };
}
