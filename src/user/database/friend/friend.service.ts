import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Friend } from './friend.entity';

@Injectable()
export class FriendService {
  constructor(
    @InjectRepository(Friend)
    private friendRepository: Repository<Friend>,
  ) {}

  // 유저 친구리스트 조회 메서드
  async readFriendList(user: number) : Promise<Friend[]> {
    return (this.friendRepository.find({ where: { user } }));
  }

  // 유저 친구 생성 메서드
  async createFriendInfo(friend: Partial<Friend>): Promise<Friend> {
    const newFriend = this.friendRepository.create(friend);
    return (this.friendRepository.save(newFriend));
  }

  // 유저 친구 수정 메서드
  async updateFriendInfo(id: number, friend: Partial<Friend>): Promise<Friend> {
    await this.friendRepository.update(id, friend);
    return (this.friendRepository.findOne({ where: { id } }));
  }

  // 유저 친구 제거 메서드
  async deleteFriendInfo(user: number, friend: number): Promise<void> {
    const deleteFriend = await this.friendRepository.findOne({ where: { user, friend} });
    if (!deleteFriend)
      return ;
    await this.friendRepository.remove(deleteFriend);
  }

  // 유저 전체 친구 삭제 메서드
  async deleteFriendList(user: number): Promise<void> {
    await this.friendRepository.delete({ user });
  }
}
