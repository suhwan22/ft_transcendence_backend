import { Module, forwardRef } from '@nestjs/common';
import { GamesController } from './games.controller';
import { GamesService } from './games.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameHistory } from './entities/game-history.entity';
import { UsersModule } from 'src/users/users.module';
import { ChatsModule } from 'src/chats/chats.module';
import { SocketsModule } from 'src/sockets/sockets.module';
import { GamesSocketService } from '../sockets/game/games-socket.service';
import { AuthModule } from 'src/auth/auth.module';
import { GameDodge } from './entities/game-dodge.entity';
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => (UsersModule)),
    forwardRef(() => (ChatsModule)),
    forwardRef(() => (SocketsModule)),
    TypeOrmModule.forFeature([
    GameHistory,
    GameDodge])],
  controllers: [GamesController],
  providers: [GamesService, GamesSocketService],
  exports: [TypeOrmModule, GamesService]
})
export class GamesModule {}