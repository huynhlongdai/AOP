import * as z from "zod";

export function parseProtocol<TSchema extends z.ZodType>(schema: TSchema, input: unknown) {
  return schema.parse(input);
}

export function safeParseProtocol<TSchema extends z.ZodType>(schema: TSchema, input: unknown) {
  return schema.safeParse(input);
}
