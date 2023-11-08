import { Controller, Post, UseGuards, Get, Res, Req, Body, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Request, Response } from 'express';
import { UsersService } from 'src/users/users.service';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { JwtTwoFactorAuthGuard } from './guards/jwt-2fa.guard';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CodeRequestDto } from './dtos/codeRequestDto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor (
    private authService: AuthService,
    private usersService: UsersService,
    ) { }

  @ApiOperation({ summary: '로그인 API' })
  @ApiBody({ type: CodeRequestDto })
  @ApiOkResponse({ description: 'Ok'})
  @Post('/login')
  async login(@Body('code') code: string, @Res({ passthrough: true }) response: Response) {
    const token = await this.authService.getAccessTokenWithOauth(code);
    const oauthUser = await this.authService.getUserWithOauth(token);
    const user = await this.authService.signUpUser(oauthUser);
    const { accessToken, ...accessOption } = await this.authService.getCookieWithAccessToken(user.name, user.id);
    const { refreshToken, ...refreshOption } = await this.authService.getCookieWithRefreshToken(user.name, user.id);
    
    await this.usersService.updateRefreshToken(refreshToken, user.id);

    response.cookie('Authentication', accessToken, accessOption);
    response.cookie('Refresh', refreshToken, refreshOption);
    return ('login success');
  }

  @ApiOperation({ summary: '로그아웃 API' })
  @ApiOkResponse({ description: 'Ok' })
  @UseGuards(JwtAuthGuard)
  @Post('/logout')
  async logout(@Req() request, @Res({ passthrough: true }) response: Response) {
    const { accessOption, refreshOption } = await this.authService.removeCookieWithTokens();
    await this.usersService.updateRefreshToken(null, request.user.userId);
    response.cookie('Authentication', '', accessOption);
    response.cookie('Refresh', '', refreshOption);
    response.cookie('TwoFactorAuth', '', accessOption);
    return ('logout success');
  }

  @ApiOperation({ summary: '토큰 재발급 API' })
  @ApiOkResponse({ description: 'Ok' })
  @UseGuards(JwtRefreshGuard)
  @Get('refresh')
  async refresh(@Req() request, @Res({ passthrough: true }) response: Response) {
    const { accessToken, ...accessOption } = await this.authService.getCookieWithAccessToken(request.user.userName, request.user.userId);
    response.cookie('Authentication', accessToken, accessOption);
    return ('token refresh success');
  }

  @ApiOperation({ summary: '2FA 구글 인증 OTP API' })
  @ApiBody({ type: CodeRequestDto })
  @ApiOkResponse({ description: 'Ok'})
  @UseGuards(JwtAuthGuard)
  @Post('2fa')
  async authenticateTwoFactorAuth(@Req() request,
                                  @Body('code') code: string,
                                  @Res({ passthrough: true }) response: Response) {
    const check = await this.authService.isVaildTwoFactorAuthCode(code, request.user);
    if (!check)
      throw new UnauthorizedException('Invaild Authentication-Code');
    const { accessToken, ...accessOption } = await this.authService.getCookieWithAccessToken(request.user.userName, request.user.userId);
    response.cookie('TwoFactorAuth', accessToken, accessOption);
    const user = this.usersService.readOnePlayer(request.user.userId);
    return (user);
  }
  
  @ApiOperation({ summary: '2FA 구글 인증 등록 API' })
  @ApiOkResponse({ description: 'Ok' })
  @UseGuards(JwtAuthGuard)
  @Post('2fa/generate')
  async getQrImageWithTwoFactorAuth(@Req() request: Request, @Res() response: Response) {
    const { optAuthUrl } = await this.authService.generateTwoFactorAuthenticationSecret(request.user);
    return (await this.authService.pipeQrCodeStream(response, optAuthUrl));
  }

  @UseGuards(JwtTwoFactorAuthGuard)
  @Get('/test')
  test() {
    return 'test success';
  }
}