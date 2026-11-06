// Injection token for ChatGateway.
//
// Why a string token instead of injecting the ChatGateway class directly:
// chat.gateway.ts imports ChatService, GroupsService and DirectMessagesService,
// and all three of those need to emit events back through the gateway. That is
// a genuine circular dependency between ES modules.
//
// `forwardRef(() => ChatGateway)` resolves Nest's *dependency-injection* graph,
// but it does not help with *module evaluation* order, because TypeScript's
// `emitDecoratorMetadata` still emits a hard reference to the class:
//
//     __metadata("design:paramtypes", [PrismaService, ChatGateway])
//
// That expression runs the moment the module is evaluated. In an ESM circular
// import the class binding is still in its temporal dead zone at that point,
// so Node throws:
//
//     ReferenceError: Cannot access 'ChatGateway' before initialization
//
// ...and the entire backend dies on boot before it can listen on a port.
//
// Injecting by string token lets the three services use `import type` for the
// gateway (erased at compile time, so no runtime reference and no cycle),
// while Nest still wires the real singleton at runtime. chat.module.ts
// registers the alias: { provide: CHAT_GATEWAY, useExisting: ChatGateway }.
export const CHAT_GATEWAY = 'CHAT_GATEWAY';
