import { Injectable } from "@nestjs/common";
import { Socket } from "socket.io";
import { UsersService } from "src/users/users.service";
import { GameRoom, PingPongPlayer } from "./entities/game.entity";
import { PlayerInfoDto } from "./dtos/player-info.dto";
import { GamesService } from "./games.service";
import { Player } from "src/users/entities/player.entity";
import { GameEngine } from "./entities/game-engine";
import { GameQueue, Queue } from "./entities/game-queue";

@Injectable()
export class GamesSocketService {
  constructor(
    private readonly usersService: UsersService,
    private readonly gamesService: GamesService,) {
    this.games = new Map<string, GameEngine>();
    this.queue = new Map<number, Queue<GameQueue>>();
  }

  games: Map<string, GameEngine>;
  queue: Map<number, Queue<GameQueue>>;

  async matchMaking(client: Socket) {
    const score = client.data.score;
    const ratingGroup = Math.floor(score / 100);
    const gameQueue = new GameQueue(client, score, 0);

    // enter waiting queue
    if (this.queue.get(ratingGroup)) {
      this.queue.get(ratingGroup).enqueue(gameQueue);
    }
    else {
      const groupQueue = new Queue<GameQueue>();
      groupQueue.enqueue(gameQueue);
      this.queue.set(ratingGroup, groupQueue);
    }

    // find match
    gameQueue.client.emit('WAIT', 'WAIT');
    if (client.data.matchInterval)
      clearInterval(client.data.matchInterval);
    const intervalId = setInterval(() => this.findMath(gameQueue, ratingGroup, intervalId), 1000);
    client.data.matchInterval = intervalId;
  }

  async findMath(gameQueue: GameQueue, ratingGroup: number, intervalId: any) {
    if (gameQueue.matched) {
      clearInterval(intervalId);
      return;
    }
    const searchRange = Math.floor(gameQueue.time / 10);
    for (let i = ratingGroup - searchRange; i <= ratingGroup + searchRange; i++) {
      const groupQueue = this.queue.get(i);
      if (groupQueue) {
        if ((groupQueue.size > 0 && i !== ratingGroup) || (groupQueue.size > 1 && i === ratingGroup)) {
          this.queue.get(ratingGroup).remove((v) => v.client.data.userId === gameQueue.client.data.userId);
          const targetQueue = this.queue.get(i).dequeue();
          gameQueue.matched = true;
          targetQueue.matched = true;
          gameQueue.client.data.matchInterval = null;
          targetQueue.client.data.matchInterval = null;

          const client = gameQueue.client;
          const targetClient = targetQueue.client;

          client.emit('MATCH', "MATCH");
          targetClient.emit('MATCH', "MATCH");

          const roomId = client.id + targetClient.id;
          await this.enterGame(client, roomId, true, true);
          await this.enterGame(targetClient, roomId, true, false);
          clearInterval(intervalId);
          break;
        }
      }
    }
    gameQueue.time++;
  }

  cancelGame(client: Socket) {
    const ratingGroup = Math.floor(client.data.score / 100);
    this.queue.get(ratingGroup).remove((v) => v.client.data.userId === client.data.userId);
    clearInterval(client.data.matchInterval);
    client.data.matchInterval = null;
    client.emit('CANCEL', 'CANCEL');
  }

  async enterGame(client: Socket, roomId: string, rank: boolean, isLeft: boolean) {
    let game = this.games.get(roomId);
    if (!game) {
      const gameRoom = new GameRoom(roomId, null, null);
      gameRoom.rank = rank;
      game = new GameEngine(null, null, gameRoom);
      this.games.set(roomId, game);
    }

    if (isLeft)
      game.leftSocket = client;
    else
      game.rightSocket = client;

    await this.enterRoom(client, game.room, isLeft);
    this.joinRoom(client, roomId);

    if (game.room.left && game.room.right) {
      const targetClient = isLeft === true ? game.rightSocket : game.leftSocket;
      client.emit("LOAD", { room: game.room, isLeft: isLeft });
      targetClient.emit("LOAD", { room: game.room, isLeft: !isLeft });
    }
  }

  joinRoom(client: Socket, roomId: string) {
    client.rooms.clear();
    client.rooms.add(roomId);
    client.join(roomId);
    client.data.roomId = roomId;
  }

  async enterRoom(client: Socket, gameRoom: GameRoom, isLeft: boolean): Promise<GameRoom> {
    const user = await this.usersService.readOnePurePlayer(client.data.userId);
    const me = new PingPongPlayer(user, false, client.data.score);
    const updateRoom = gameRoom;
    if (isLeft)
      updateRoom.left = me;
    else
      updateRoom.right = me;
    return (updateRoom);
  }

  readyGame(client: Socket) {
    const game = this.games.get(client.data.roomId);
    const isLeft = game.room.getUserPosition(client.data.userId);
    const player = isLeft === true ? game.room.left : game.room.right;
    let msg = '';

    player.isReady = !player.isReady;

    if (player.isReady)
      msg = `game will be started in ${10 - player.readyTime}s`;
    else {
      player.readyTime = 0;
      clearInterval(client.data.readyInterval);
      client.data.readyInterval = null;
    }

    game.leftSocket.emit("READY", { room: game.room, isLeft: true });
    game.rightSocket.emit("READY", { room: game.room, isLeft: false });

    game.leftSocket.emit('ANNOUNCE', msg);
    game.rightSocket.emit('ANNOUNCE', msg);

    if (game.room.left.isReady && game.room.right.isReady) {
      this.startGame(game);
    }
    // interval
    if (player.isReady) {
      if (client.data.readyInterval) {
        clearInterval(client.data.readyInterval);
        client.data.readyInterval = null;
      }
      const intervalId = setInterval(() => this.checkTimeReady(client, game, player), 1000);
      client.data.readyInterval = intervalId;
    }
  }

  checkTimeReady(client: Socket, game: GameEngine, player: PingPongPlayer) {
    if (game.room.start || !player.isReady) {
      const msg = ``;
      game.leftSocket.emit('ANNOUNCE', msg);
      game.rightSocket.emit('ANNOUNCE', msg);
      player.readyTime = 0;
      clearInterval(client.data.readyInterval);
      client.data.readyInterval = null;
      return;
    }

    player.readyTime++;
    const msg = `game will be started in ${10 - player.readyTime}s`;
    game.leftSocket.emit('ANNOUNCE', msg);
    game.rightSocket.emit('ANNOUNCE', msg);

    if (player.readyTime === 10) {
      clearInterval(client.data.readyInterval);
      client.data.readyInterval = null;
      // start game
      this.startGame(game);
    }
  }

  startGame(game: GameEngine) {
    game.room.start = true;

    game.leftSocket.emit("START", { room: game.room, isLeft: true });
    game.rightSocket.emit("START", { room: game.room, isLeft: false });

    game.stopBall(2000);
    const id = setInterval(() => this.startPongGame(game, id), 10);
  }

  startPongGame(game: GameEngine, intervalId: any) {
    if (!game.room.stop) {
      if (!game.reset)
        game.update();
      game.leftSocket.emit('PONG', game.room.gameInfo);
      game.rightSocket.emit('PONG', game.room.gameInfo);
    }
    if (game.checkGameOver()) {
      this.endGame(game.leftSocket, game.rightSocket, game.room);
      clearInterval(intervalId);
      this.games.delete(game.room.roomId);
      game.leftSocket.data.roomId = null;
      game.rightSocket.data.roomId = null;
    }
  }

  updateGameInfo(client: Socket, data: any) {
    const game = this.games.get(client.data.roomId);
    if (data.isLeft)
      game.room.gameInfo.left = data.bar;
    else
      game.room.gameInfo.right = data.bar;
  }

  updateGameOption(client: Socket, data: any) {
    const game = this.games.get(client.data.roomId);
    game.room.option = data;
    client.to(client.data.roomId).emit("OPTION", game.room.option);
  }

  updateGameScore(client: Socket, data: any) {
    const game = this.games.get(client.data.roomId);
    if (data.isLeft)
      game.room.score.left++;
    else
      game.room.score.right++;
    client.to(client.data.roomId).emit("SCORE", game.room.score);
  }

  pauseGame(client: Socket) {
    const game = this.games.get(client.data.roomId);
    const targetClient = game.leftSocket.data.userId === client.data.userId ? game.rightSocket : game.leftSocket;
    const isLeft = game.room.getUserPosition(client.data.userId);
    const player = isLeft === true ? game.room.left : game.room.right;
    
    game.room.stop = true;
    player.isPause = true;
    player.pause++;
    client.to(game.room.roomId).emit("PAUSE", "PAUSE");
    const msg = `${player.player.name}'s remaining pause: ${3 - player.pause}time, ${20 - player.pauseTime}s`;
    client.emit('ANNOUNCE', msg);
    targetClient.emit('ANNOUNCE', msg);

    if (player.pause === 3) {
      clearInterval(client.data.pauseInterval);
      client.data.pauseInterval = null;
      this.endGameWithExtra(client, targetClient, game.room);
      this.games.delete(client.data.roomId);
      client.data.roomId = null;
      targetClient.data.roomId = null;
      return;
    }

    if (client.data.pauseInterval) {
      clearInterval(client.data.pauseInterval);
      client.data.pauseInterval = null;
    }
    const intervalId = setInterval(() => this.checkTimePause(client, targetClient, game.room, player), 1000);
    client.data.pauseInterval = intervalId;
  }

  checkTimePause(client: Socket, targetClient: Socket, gameRoom: GameRoom, player: PingPongPlayer) {
    if (!player.isPause) {
      clearInterval(client.data.pauseInterval);
      client.data.pauseInterval = null;
      return;
    }

    player.pauseTime++;
    const msg = `${player.player.name}'s remaining pause: ${3 - player.pause}time, ${20 - player.pauseTime}s`;
    client.emit('ANNOUNCE', msg);
    targetClient.emit('ANNOUNCE', msg);

    if (player.pauseTime === 20) {
      clearInterval(client.data.pauseInterval);
      client.data.pauseInterval = null;
      this.endGameWithExtra(client, targetClient, gameRoom);
      this.games.delete(client.data.roomId);
      client.data.roomId = null;
      targetClient.data.roomId = null;
    }
  }

  resumeGame(client: Socket) {
    const game = this.games.get(client.data.roomId);
    const isLeft = game.room.getUserPosition(client.data.userId);
    const player = isLeft === true ? game.room.left : game.room.right;

    player.isPause = false;

    if (!game.room.left.isPause && !game.room.right.isPause) {
      game.stopBall(2000);
      game.room.stop = false;
      clearInterval(client.data.pauseInterval);
      client.data.pauseInterval = null;
      client.to(game.room.roomId).emit("RESUME", "RESUME");
      client.to(game.room.roomId).emit("ANNOUNCE", '');
    }
  }

  // 몰수패 client가 4번째 pause를 건쪽이기 때문에 targetClient 가 무조건 승리
  async endGameWithExtra(client: Socket, targetClient: Socket, gameRoom: GameRoom): Promise<void> {
    let win: Player, loss: Player;
    let winScore: number, lossScore: number, winnerIsLeft: boolean;

    //pause를 건 쪽이 left인 경우
    if (gameRoom.getUserPosition(client.data.userId)) {
      win = gameRoom.right.player;
      loss = gameRoom.left.player;
      winScore = gameRoom.score.right;
      lossScore = gameRoom.score.left;
      winnerIsLeft = false;
    }
    else {
      win = gameRoom.left.player;
      loss = gameRoom.right.player;
      winScore = gameRoom.score.left;
      lossScore = gameRoom.score.right;
      winnerIsLeft = true;
    }
    await this.gamesService.createGameHistoryWitData(win.id, loss, true, winScore, lossScore, gameRoom.rank);
    await this.gamesService.createGameHistoryWitData(loss.id, win, false, lossScore, winScore, gameRoom.rank);
    await this.usersService.updateUserGameRecord(win, true, gameRoom.rank);
    await this.usersService.updateUserGameRecord(loss, false, gameRoom.rank);
    client.to(gameRoom.roomId).emit("END", { score: gameRoom.score, winnerIsLeft: winnerIsLeft });
    client.leave(gameRoom.roomId);
    targetClient.leave(gameRoom.roomId);
  }

  async endGame(client: Socket, targetClient: Socket, gameRoom: GameRoom): Promise<void> {
    let win: Player, loss: Player;
    let winScore: number, lossScore: number, isLeft: boolean;
    if (gameRoom.score.left > gameRoom.score.right) {
      win = gameRoom.left.player;
      loss = gameRoom.right.player;
      winScore = gameRoom.score.left;
      lossScore = gameRoom.score.right;
      isLeft = true;
    }
    else {
      win = gameRoom.right.player;
      loss = gameRoom.left.player;
      winScore = gameRoom.score.right;
      lossScore = gameRoom.score.left;
      isLeft = false;
    }
    await this.gamesService.createGameHistoryWitData(win.id, loss, true, winScore, lossScore, gameRoom.rank);
    await this.gamesService.createGameHistoryWitData(loss.id, win, false, lossScore, winScore, gameRoom.rank);
    await this.usersService.updateUserGameRecord(win, true, gameRoom.rank);
    await this.usersService.updateUserGameRecord(loss, false, gameRoom.rank);
    client.to(gameRoom.roomId).emit("END", { score: gameRoom.score, winnerIsLeft: isLeft });
    client.leave(gameRoom.roomId);
    targetClient.leave(gameRoom.roomId);
  }

  existGameRoom(client: Socket) {
    const game = this.games.get(client.data.roomId);
    
    if (game.room.start === false)
      this.dodgeGame(client, game);
    else 
      this.pauseGame(client);
  }

  dodgeGame(client: Socket, game: GameEngine) {
    const targetClient = game.leftSocket === client ? game.rightSocket : game.leftSocket;
    targetClient.emit("DODGE", "DODGE");
    this.games.delete(client.data.roomId);
    client.data.roomId = null;
    targetClient.data.roomId = null;
  }

  checkGameAlready(client: Socket) {
    const userId = client.data.userId;
    let game: GameEngine;
    this.games.forEach((v, k, m) => {
      if (userId === v.leftSocket.data.userId || userId === v.rightSocket.data.userId) {
        game = v;
        return;
      }
    });
    if (game) {
      const roomId = game.room.roomId;
      const isLeft = game.room.getUserPosition(client.data.userId);
      if (isLeft)
        game.leftSocket = client;
      else
        game.rightSocket = client;
      client.data.roomId = roomId;
      client.join(roomId);
      client.emit("RELOAD", { room: game.room, isLeft: isLeft });
      this.resumeGame(client);
    }
    else {
      client.emit("RELOAD", { room: null, isLeft: null });
    }
  }

  async sendMessage(client: Socket, data: any) {
    const game = this.games.get(client.data.roomId);
    const targetClient = client.data.userId === game.leftSocket.data.userId ? game.rightSocket : game.leftSocket;
    targetClient.emit("MSG", data);
  }

}