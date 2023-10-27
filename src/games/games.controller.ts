import { Controller, Get, Post, Body, Put, Param, Delete, NotFoundException } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { GamesService } from './games.service';
import { GameHistory } from './entities/game-history.entity';

@ApiTags('games')
@Controller('games')
export class GamesController {
  constructor(
    private readonly gamesService: GamesService
  ) {}

/* History Part */
  //get all history
  @ApiOperation({ summary: '게임 기록 전체 조회 API' })
  @ApiOkResponse({ description: 'Ok', type: GameHistory, isArray: true })
  @Get('history')
  async readAllHistory(): Promise<GameHistory[]> {
    return (this.gamesService.readAllGameHistory());
  }

  //get history by id
  @ApiOperation({ summary: '특정 게임 기록 조회 API' })
  @ApiOkResponse({ description: 'Ok', type: GameHistory})
  @Get('history/:id')
  async readOneHistory(@Param('id') id: number): Promise<GameHistory> {
    const history = await this.gamesService.readOneGameHistory(id);
    if (!history) {
      throw new NotFoundException('History does not exist!');
    }
    return (history);
  }

  //create history
  @ApiBody({ type: GameHistory })
  @ApiOperation({ summary: '게임 기록 추가 API' })
  @ApiCreatedResponse({ description: 'success', type: GameHistory })
  @Post('history')
  async createHistory(@Body() game: GameHistory): Promise<GameHistory> {
    return (this.gamesService.createGameHistory(game));
  }

  //update history
  @ApiBody({ type: GameHistory })
  @ApiOperation({ summary: '게임 기록 내용 변경 API' })
  @ApiCreatedResponse({ description: 'success', type: GameHistory })
  @Put('history/:id')
  async updateGameHistoryInfo(@Param('id') id: number, @Body() game: GameHistory): Promise<any> {
    return (this.gamesService.updateGameHistoryInfo(id, game));
  }

  //delete history
  @ApiOperation({ summary: '게임 기록 제거 API' })
  @ApiOkResponse({ description: 'Ok' })
  // @ApiQuery({ name: 'channel', type: 'number' })
  // @ApiQuery({ name: 'user', type: 'number' }) // 현재는 {id}로 만 제거되는 상태
  @Delete('history/:id')
  async deleteGameHistory(@Param('id') id: number): Promise<any> {
    const history = await this.gamesService.readOneGameHistory(id);
    if (!history) {
      throw new NotFoundException('History does not exist!');
    }
    return (this.gamesService.deleteGameHistory(id));
  }
}