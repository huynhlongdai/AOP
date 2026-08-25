import * as z from "zod";

export const AOP_PROTOCOL_VERSION = "0.1.0" as const;

export const ProtocolVersionSchema = z.literal(AOP_PROTOCOL_VERSION);
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;
