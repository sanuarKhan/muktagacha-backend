import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { ChatService } from './chat.service.js';
import { GroupsService } from './groups.service.js';

interface AuthedSocket extends Socket {
  data: { userId: string; role: string };
}

// Real-time delivery layer on top of the REST endpoints above: the REST
// API is the source of truth (every write goes through it so validation,
// ownership checks, and persistence happen in one place), this gateway
// just pushes the resulting row to connected clients instantly instead of
// making them poll. Clients still call the REST endpoints to actually send
// a message/post — this gateway only broadcasts + handles room membership.
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private chatService: ChatService,
    private groupsService: GroupsService,
  ) {}

  // Same JWT used for REST auth (see jwt.strategy.ts) - socket.io has no
  // concept of an Authorization header on every event, so the token is
  // read once at connection time from the handshake and the decoded
  // userId/role are reused for every event on this socket after that.
  handleConnection(client: AuthedSocket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ||
        (client.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('No token provided');

      const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'dev-secret-change-me') as {
        sub: string;
        role: string;
      };
      client.data = { userId: payload.sub, role: payload.role };
    } catch (err) {
      this.logger.warn(`Rejected socket connection: ${(err as Error).message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: AuthedSocket) {
    // No server-side state to clean up - room membership is per-socket and
    // socket.io drops it automatically on disconnect.
  }

  // ───────────────────────── Private conversations ─────────────────────────

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    // Re-uses the same ownership check as the REST endpoint - a socket
    // can't join a room for a conversation it isn't part of, even if it
    // guesses the id.
    await this.chatService.getMessages(data.conversationId, client.data.userId);
    client.join(`conversation:${data.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  leaveConversation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    client.leave(`conversation:${data.conversationId}`);
    return { ok: true };
  }

  // Called by ChatService after a REST write (see chat.controller.ts calling
  // into this via emitNewMessage) - kept as a plain method rather than
  // @SubscribeMessage since it's server-initiated, not client-initiated.
  emitNewMessage(conversationId: string, message: unknown) {
    this.server.to(`conversation:${conversationId}`).emit('conversation:message', message);
  }

  // ───────────────────────── Group topics ─────────────────────────

  @SubscribeMessage('topic:join')
  async joinTopic(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { topicId: string }) {
    await this.groupsService.getPosts(data.topicId, client.data.userId);
    client.join(`topic:${data.topicId}`);
    return { ok: true };
  }

  @SubscribeMessage('topic:leave')
  leaveTopic(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { topicId: string }) {
    client.leave(`topic:${data.topicId}`);
    return { ok: true };
  }

  emitNewPost(topicId: string, post: unknown) {
    this.server.to(`topic:${topicId}`).emit('topic:post', post);
  }

  // ───────────────────────── Public shop Q&A ─────────────────────────

  @SubscribeMessage('shop:join')
  joinShop(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { organizationId: string }) {
    // Public board - no ownership check needed, anyone can watch a shop's
    // Q&A room live, same as anyone can view it via the REST GET.
    client.join(`shop:${data.organizationId}`);
    return { ok: true };
  }

  @SubscribeMessage('shop:leave')
  leaveShop(@ConnectedSocket() client: AuthedSocket, @MessageBody() data: { organizationId: string }) {
    client.leave(`shop:${data.organizationId}`);
    return { ok: true };
  }

  emitNewQuestion(organizationId: string, question: unknown) {
    this.server.to(`shop:${organizationId}`).emit('shop:question', question);
  }

  emitNewReply(organizationId: string, reply: unknown) {
    this.server.to(`shop:${organizationId}`).emit('shop:reply', reply);
  }
}
