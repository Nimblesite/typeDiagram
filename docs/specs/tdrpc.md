# TDRPC Specification

> Status: roadmap spec for `[TDRPC-*]`.
> Depends on: [tdbin-wire-format.md](tdbin-wire-format.md).

## Scope

`[TDRPC-*]` maps typeDiagram function definitions to a streaming RPC service
contract carried by framed TDBIN messages.

## Contract Model

- A typeDiagram `function` declaration defines one RPC method.
- The request and response payloads MUST be named typeDiagram ADTs.
- Method ids MUST be stable numeric ids derived from the canonical service
  schema, with collision detection at build time.
- Unary, server-streaming, client-streaming, and bidirectional streaming are
  selected from the function signature shape.

## Transport

- QUIC is the primary transport.
- Frames MUST be self-delimiting TDBIN frames using `[TDBIN-MSG-STREAM]`.
- Capability pointer kind `11` is reserved for remote object references and
  promise pipelining.

## Acceptance

- A future service generator emits client and server stubs from one `.td` file.
- Interop tests cover unary, streaming, cancellation, backpressure, unknown
  method ids, and schema-hash negotiation.
