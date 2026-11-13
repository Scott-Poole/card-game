import { expect, it } from "vitest";
import { decodeServerMessage, decodeClientMessage } from "./messages.ts";

it("decodes a welcome message", () => {
  expect(decodeServerMessage('{"type":"welcome"}')).toEqual({
    ok: true,
    message: { type: "welcome" },
  });
});

it.each([
  ["object", { type: "welcome" }, { ok: true, message: { type: "welcome" } }],
  ["wrong type", 42, { ok: false, error: "invalid-message" }],
  ["null", null, { ok: false, error: "invalid-message" }],
  ["missing fields", {}, { ok: false, error: "invalid-message" }],
  ["non-JSON", "{", { ok: false, error: "invalid-json" }],
  [
    "extra fields",
    '{"type":"welcome","extra":1}',
    { ok: false, error: "invalid-message" },
  ],
  ["unknown type", { type: "other" }, { ok: false, error: "invalid-message" }],
  ["JSON string", '"{}"', { ok: false, error: "invalid-message" }],
  ["array", [], { ok: false, error: "invalid-message" }],
])("server decoder: %s", (_name, input, expected) => {
  expect(decodeServerMessage(input)).toEqual(expected);
});

it.each([
  ["valid JSON", '{"type":"welcome"}', "unrecognized-message"],
  ["object", { type: "welcome" }, "unrecognized-message"],
  ["wrong type", 42, "unrecognized-message"],
  ["missing fields", {}, "unrecognized-message"],
  ["non-JSON", "{", "invalid-json"],
  ["extra fields", { type: "welcome", extra: true }, "unrecognized-message"],
])("client decoder rejects %s", (_name, input, error) => {
  expect(decodeClientMessage(input)).toEqual({ ok: false, error });
});
