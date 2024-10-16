import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { compare } from 'bcrypt';
import ms from 'ms';

import { User } from '../../db/entities/user.entity';
import { RefreshToken } from '../../db/entities/refresh-token.entity';
import { SignUpDto } from '../auth/dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { MailerService } from '../mailer/mailer.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private configService: ConfigService,
    @Inject('AccessTokenService') private accessJwtService: JwtService,
    @Inject('RefreshTokenService') private refreshJwtService: JwtService,
    private userService: UsersService,
    private mailerService: MailerService,
    @InjectRepository(RefreshToken)
    private refreshRepository: Repository<RefreshToken>,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<void> {
    const user = await this.userService.create(signUpDto);

    await this.mailerService.sendConfirmationEmail(user.id, user.email);

    return;
  }

  async signIn(
    signInDto: SignInDto,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const { email, password } = signInDto;

    const user = await this.userService.findByEmail(email);

    if (!user?.password || !(await compare(password, user.password))) {
      throw new UnauthorizedException();
    }

    const accessTokenPayload = await this.createAccessToken(user);
    const refreshTokenPayload = await this.createRefreshToken(user);

    const newRefreshToken = await this.refreshRepository.create({
      user: user,
      expirationDate: refreshTokenPayload.expirationDate,
      token: refreshTokenPayload.token,
    });
    const savedRefreshToken =
      await this.refreshRepository.save(newRefreshToken);

    return {
      accessToken: accessTokenPayload.token,
      refreshToken: savedRefreshToken.token,
    };
  }

  async logout(userId: number, token: string) {
    return this.refreshRepository.update(
      { token, user: { id: userId } },
      { invalidated: true },
    );
  }

  async refreshAccessToken(userId: number, token: string) {
    const user = await this.userService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const refreshToken = await this.refreshRepository.findOne({
      where: { token },
    });

    if (!refreshToken || refreshToken.invalidated) {
      throw new UnauthorizedException('Refresh token invalidated');
    }

    return this.createAccessToken(user);
  }

  private async createAccessToken(user: User) {
    const accessTokenDuration = this.configService.getOrThrow<string>(
      'JWT_ACCESS_TOKEN_EXPIRATION',
    );

    const accessTokenExpirationDate = new Date(
      Date.now() + ms(accessTokenDuration),
    );

    return {
      token: this.accessJwtService.sign({
        sub: user.id,
      }),
      expirationDate: accessTokenExpirationDate,
    };
  }

  private async createRefreshToken(user: User) {
    const refreshTokenDuration = this.configService.getOrThrow<string>(
      'JWT_REFRESH_TOKEN_EXPIRATION',
    );

    const refreshTokenExpirationDate = new Date(
      Date.now() + ms(refreshTokenDuration),
    );

    return {
      token: this.refreshJwtService.sign({
        sub: user.id,
      }),
      expirationDate: refreshTokenExpirationDate,
    };
  }
}
