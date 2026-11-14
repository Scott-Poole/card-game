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
  [
    "nested welcome string",
    JSON.stringify(JSON.stringify({ type: "welcome" })),
    { ok: false, error: "invalid-message" },
  ],
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

it("rejects an inherited welcome discriminator", () => {
  const input: unknown = Object.create(
    { type: "welcome" },
    { extra: { value: 1, enumerable: true } },
  );
  expect(decodeServerMessage(input)).toEqual({
    ok: false,
    error: "invalid-message",
  });
});

it.each(["invalid-json", "invalid-message", "unrecognized-message"])(
  "decodes error %s",
  (error) => {
    expect(
      decodeServerMessage(JSON.stringify({ type: "error", error })),
    ).toEqual({
      ok: true,
      message: { type: "error", error },
    });
  },
);
