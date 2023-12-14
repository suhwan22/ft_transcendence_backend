import { forwardRef, Inject, UseFilters, UseGuards } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatsGateway } from 'src/sockets/chat/chats.gateway';
import { LobbyGateway } from 'src/sockets/lobby/lobby.gateway';
import { UsersService } from 'src/users/users.service';
import { GameRoom } from '../../games/entities/game.entity';
import { GamesSocketService } from './games-socket.service';
import { AuthService } from 'src/auth/auth.service';
import { JwtWsGuard } from 'src/auth/guards/jwt-ws.guard';
import { SocketExceptionFilter } from '../sockets.exception.filter';

@WebSocketGateway(3131, {
  cors: { credentials: true, origin: 'http://localhost:5173' }, 
  namespace: '/games'
})
@UseFilters(SocketExceptionFilter)
export class GamesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    @Inject(forwardRef(() => ChatsGateway))
    private readonly chatsGateway: ChatsGateway,
    @Inject(forwardRef(() => LobbyGateway))
    private readonly lobbyGateway: LobbyGateway,
    private readonly usersService: UsersService,
    private readonly authServeice: AuthService,
    private readonly gamesSocketService: GamesSocketService,) {
    this.clients = new Map<number, Socket>();
  }

  @WebSocketServer()
  server: Server;
  clients: Map<number, Socket>;

  //소켓 연결시 유저목록에 추가
  async handleConnection(client: Socket, data) {
      const payload = this.authServeice.verifyBearTokenWithCookies("client.request.headers.cookie", "TwoFactorAuth");

      client.leave(client.id);
      client.data.userId = payload.sub;
      client.data.rating = (await this.usersService.readOneUserGameRecord(client.data.userId)).rating;
      this.clients.set(client.data.userId, client);
      this.usersService.updatePlayerStatus(client.data.userId, 0);
      this.lobbyGateway.sendUpdateToFriends(client.data.userId);
      this.chatsGateway.sendUpdateToChannelMember(client.data.userId);

      this.gamesSocketService.checkGameAlready(client);
      console.log('games connected', client.id);
  }

  //소켓 연결 해제시 유저목록에서 제거
  async handleDisconnect(client: Socket): Promise<void> {
    try {
      console.log('game disonnected', client.id);
      const key = client.data.userId;
      if (!key)
        return;

      // 해당 user가 gameRoom 안에 있는 경우
      if (client.data.roomId) {
        this.gamesSocketService.existGameRoom(client);
      }
      else {
        if (client.data.intervalId !== null) {
          this.gamesSocketService.cancelGame(client);
        }
        this.clients.delete(key);
        this.usersService.updatePlayerStatus(key, 3);
        this.chatsGateway.sendUpdateToChannelMember(key);
        this.lobbyGateway.sendUpdateToFriends(key);
      }
    }
    catch (e) {
      console.log(e);
    }
  }

  @UseGuards(JwtWsGuard)
  @SubscribeMessage('MATCH')
  async matchMaking(client: Socket, userId: number) {
    this.gamesSocketService.matchMaking(client, 60);
  }

  @SubscribeMessage('READY')
  readyGame(client: Socket, data: GameRoom) {
    this.gamesSocketService.readyGame(client);
  }

  @SubscribeMessage('PING')
  ping(client: Socket, data: any) {
    this.gamesSocketService.updateGameInfo(client, data);
  }

  @SubscribeMessage('SCORE')
  sendScore(client: Socket, data: any) {
    this.gamesSocketService.updateGameScore(client, data);
  }

  @SubscribeMessage('OPTION')
  sendOption(client: Socket, data: any) {
    this.gamesSocketService.updateGameOption(client, data);
  }

  @SubscribeMessage('PAUSE')
  sendPauseGame(client: Socket, data: any) {
    this.gamesSocketService.pauseGame(client);
  }

  @SubscribeMessage('JOIN_GAME')
  async join(client: Socket, data: any) {
    const isLeft = data.gameRequest.send.id === client.data.userId ? true : false;
    this.gamesSocketService.enterGame(client, data.roomId, false, isLeft);
  }

  @SubscribeMessage('MSG')
  sendMessage(client: Socket, data: any) {
    this.gamesSocketService.sendMessage(client, data);
  }

  @SubscribeMessage('RESUME')
  sendResumeGame(client: Socket, data: any) {
    this.gamesSocketService.resumeGame(client);
  }

  @SubscribeMessage('CANCEL')
  cancelGame(client: Socket, data: any) {
    if (client.data.intervalId !== null) {
      this.gamesSocketService.cancelGame(client);
    }
  }
}