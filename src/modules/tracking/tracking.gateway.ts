import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '../../auth/roles.enum';
import { RidersService } from '../riders/riders.service';

type AuthedSocketData = {
  user?: { userId: string; role: Role };
};

@WebSocketGateway({ namespace: '/tracking', cors: { origin: '*' } })
export class TrackingGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly ridersService: RidersService,
  ) {}

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) return;

    try {
      const payload = await this.jwtService.verifyAsync<{
        userId: string;
        role: Role;
      }>(token, {
        secret: this.configService.getOrThrow<string>('SUPABASE_JWT_SECRET'),
      });

      (client.data as AuthedSocketData).user = {
        userId: payload.userId,
        role: payload.role,
      };

      client.join(`user_${payload.userId}`);
      client.join(`${payload.role.toLowerCase()}_${payload.userId}`);
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('joinOrderRoom')
  async joinOrderRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId: string },
  ) {
    client.join(`order_${body.orderId}`);
    return { joined: `order_${body.orderId}` };
  }

  @SubscribeMessage('joinStoreRoom')
  async joinStoreRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { storeId: string },
  ) {
    client.join(`store_${body.storeId}`);
    return { joined: `store_${body.storeId}` };
  }

  @SubscribeMessage('joinRiderRoom')
  async joinRiderRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { riderId: string },
  ) {
    client.join(`rider_${body.riderId}`);
    return { joined: `rider_${body.riderId}` };
  }

  @SubscribeMessage('riderLocationUpdate')
  async riderLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { orderId: string; latitude: number; longitude: number },
  ) {
    const user = (client.data as AuthedSocketData).user;
    if (!user || user.role !== Role.RIDER) {
      return { ok: false };
    }

    await this.ridersService.upsertRiderLocation({
      riderId: user.userId,
      orderId: body.orderId,
      latitude: body.latitude,
      longitude: body.longitude,
    });

    this.server.to(`order_${body.orderId}`).emit('location_update', {
      lat: body.latitude,
      lng: body.longitude,
    });

    return { ok: true };
  }

  emitToStore(storeId: string, event: string, payload: unknown) {
    this.server.to(`store_${storeId}`).emit(event, payload);
  }

  emitToOrder(orderId: string, event: string, payload: unknown) {
    this.server.to(`order_${orderId}`).emit(event, payload);
  }

  emitToRider(riderId: string, event: string, payload: unknown) {
    this.server.to(`rider_${riderId}`).emit(event, payload);
  }

  private extractToken(client: Socket) {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken;

    const header = client.handshake.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length);
    }

    return null;
  }
}
