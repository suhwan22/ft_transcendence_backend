import { Injectable } from "@nestjs/common";
import { ChatsService } from "./chats.service";
import { Socket } from 'socket.io';
import { ChannelConfig } from "./entities/channel-config.entity";
import { UsersService } from "src/users/users.service";
import { ChatMute } from "./entities/chat-mute.entity";
import { ClientSocket } from "./chats.gateway";


@Injectable()
export class ChatsSocketService {
  private chatRoomList: Record<string, chatRoomListDTO>;

  constructor(
    private readonly chatsService: ChatsService,
    private readonly usersService: UsersService
  ) {
    this.chatRoomList = {
      'room:lobby': {
        roomId: 'room:lobby',
        chat: null,
      },
    };
  }

  getInfoMessage(message: string) {
    return ({
      id: null,
      user: { id: null, name: '정보', avatar: null, status: 0, date: null },
      content: message,
      date: new Date(),
    });
  }

  async sendMessage(client: Socket, message) {
    let log;
    const chatMute = await this.chatsService.readChatMute(message.channelId, message.userId);
    if (chatMute && !this.checkMuteTime(chatMute)) {
      log = this.getInfoMessage('채팅 금지로 인하여 일정 시간동안 채팅이 금지됩니다.');
      client.emit('NOTICE', log);
      return;
    }
    else if (chatMute && this.checkMuteTime(chatMute))
      this.chatsService.deleteMuteInfo(chatMute.id);
    const chatLogRequest = {
      channelId: message.channelId,
      userId: message.userId,
      content: message.content
    }
    log = await this.chatsService.createChatLogInfo(chatLogRequest);
    delete log.channel;
    client.to(client.data.roomId).emit('MSG', log);  //전체에게 방송함
    return (log);
  }

  async createChatRoom(client: Socket, channelId: number, userId: number) {
    const chat = await this.chatsService.readOnePureChannelConfig(channelId);
    const roomId = channelId.toString();
    const player = await this.usersService.readOnePurePlayer(userId);

    this.chatRoomList[roomId] = {
      roomId,
      chat,
    };
  }

  async enterChatRoom(client: Socket, channelId: number, userId: number) {
    const roomId = channelId.toString();
    const player = await this.usersService.readOnePurePlayer(userId);

    const channelMemberRequest = {
      channelId: channelId,
      userId: userId,
      op: false
    }
    await this.chatsService.createChannelMember(channelMemberRequest);

    // room이 없는 경우 새로 만듬
    if (!this.getChatRoom(roomId)) {
      await this.createChatRoom(client, channelId, userId);
    }

    this.connectChatRoom(client, channelId, userId);

    const { chat } = this.getChatRoom(roomId);

    // memlist 동기화 하는거 추가 해야함
    // channellist 동기화 하는거 추가 해야함
    
    
    const log = this.getInfoMessage(`${player.name}님이 ${chat.title}방에 입장하셨습니다.`);
    client.to(roomId).emit('NOTICE', log);
  }

  async createAndEnterChatRoom(client: Socket, channelId: number, userId: number) {
    const roomId = channelId.toString();
    const player = await this.usersService.readOnePurePlayer(userId);

    const channelMemberRequest = {
      channelId: channelId,
      userId: userId,
      op: true
    }
    await this.chatsService.createChannelMember(channelMemberRequest);

    this.createChatRoom(client, channelId, userId);

    this.connectChatRoom(client, channelId, userId);

    const { chat } = this.getChatRoom(roomId);
    
    const log = this.getInfoMessage(`${player.name}님이 ${chat.title}방에 입장하셨습니다.`);
    client.to(roomId).emit('NOTICE', log);
  }

  async connectChatRoom(client: Socket, channelId: number, userId: number) {
    const roomId = channelId.toString();
    client.leave(client.data.roomId);
    client.data.roomId = roomId;
    client.rooms.clear();
    client.rooms.add(roomId);
    client.join(roomId);

    // 들어가는 방 채널 멤버들 전달
    await this.sendChannelMember(client, channelId);

    // 채널 리스트 다시 전달
    await this.sendChannelList(client, userId);

    // 최근 chat_log 50개 전달
    let log = await this.chatsService.readLatestChatLog(channelId);
    client.emit('LOADCHAT', log);
  }

  async exitChatRoom(client: Socket, channelId: number, userId: number, word: string) {
    const player = await this.usersService.readOnePurePlayer(userId);
    const roomId = channelId.toString();

    const log = this.getInfoMessage(`${player.name}님이 ${word}`);
    client.to(roomId).emit('NOTICE', log);

    client.data.roomId = 'room:lobby';
    client.leave(roomId);
    client.rooms.clear();
    client.rooms.add('room:lobby');
    client.join('room:lobby');

    // 채널 리스트 다시 전달
    await this.sendChannelList(client, userId);

    // roomId에 있는 사람들에게 바뀐 채널 멤버 전달
    await this.sendChannelMember(client, channelId);

  }

  getChatRoom(roomId: string): chatRoomListDTO {
    return this.chatRoomList[roomId];
}

  getChatRoomList(): Record<string, chatRoomListDTO> {
    return this.chatRoomList;
  }

  deleteChatRoom(roomId: string) {
    delete this.chatRoomList[roomId];
  }

  async isOpUser(channelId: number, userId: number) {
    const channelMember = await this.chatsService.readChannelMember(channelId, userId);
    return (channelMember.op);
  }

  // op
  async commandOp(client: Socket, channelId: number, target: string) {
    try {
      const user = await this.usersService.readOnePurePlayerWithName(target);
      const channelMember = await this.chatsService.readChannelMember(channelId, user.id);
      this.chatsService.updateChannelMemberOp(channelMember.id, false);
      return (`"${target}"님에게 OP 권한을 부여 하였습니다.`);
    } catch (e) {
      return (`OP 권한 부여 실패`);
    }
  }

  // kick
  async commandKick(client: Socket, channelId: number, target: string, targetClient: ClientSocket) {
    try {
      const roomId = channelId.toString();
      // 타겟이 소켓 연결 되어 있지 않을 경우
      if (!targetClient) {
        const channelMembers = await this.chatsService.readOneChannelMember(channelId);
        const member = channelMembers.find((member) => member.user.name == target);
        if (!member)
          return ('채널 맴버가 아닙니다.');
        await this.chatsService.deleteChannelMember(member.id);
        this.sendChannelMember(client, channelId);
      }
      else {
        // 타겟이 현재 채팅방일 경우
        if (targetClient.socket.data.roomId === roomId) 
          targetClient.socket.emit("KICK", targetClient.userSocket.user.id);
        else {
          const channelMembers = await this.chatsService.readOneChannelMember(channelId);
          const member = channelMembers.find((member) => member.user.name == target);
          if (!member)
            return ('채널 맴버가 아닙니다.');
          await this.chatsService.deleteChannelMember(member.id);
          this.sendChannelList(targetClient.socket, targetClient.userSocket.user.id);
          this.sendChannelMember(client, channelId);
        }
      }
      return (`${target} 님을 강퇴하였습니다.`);
    } catch (e) {
      return ('실패');
    }
  }

  async sendChannelMember(client: Socket, channelId: number) {
    const roomId = channelId.toString();
    const updateMembers = await this.chatsService.readOneChannelMember(channelId);
    client.to(roomId).emit('INFO_CH_MEMBER', updateMembers);
  }

  async sendChannelList(client: Socket, userId: number) {
    const otherList = await this.usersService.readChannelListWithoutUser(userId);
    const meList = await this.usersService.readChannelListWithUser(userId);
    const channelList = { other: otherList, me: meList };
    client.emit('INFO_CH_LIST', channelList);
  }

  // ban
  async commandBan(client: Socket, channelId: number, target: string, tagetSocket: ClientSocket) {
    try {
      if (target === '') {
        client.emit("BAN", await this.chatsService.readBanList(channelId));
        return (null);
      }
      const user = await this.usersService.readOnePurePlayerWithName(target);
      if (!user)
        return ('존재하지 않는 유저입니다.');
      const chatBan = await this.chatsService.readChatBan(channelId, user.id);
      if (chatBan)
        return ('이미 밴 목록에 추가된 유저입니다.');
      const chatBanRequest = {
        channelId: channelId,
        userId: user.id
      }
      this.chatsService.createBanInfo(chatBanRequest);

      // 이미 채팅방에 있으면 강퇴
      const channelMembers = await this.chatsService.readOneChannelMember(channelId);
      const member = channelMembers.find((member) => member.user.name == target);
      if (member) {
        this.commandKick(client, channelId, target, tagetSocket);
      }

      return ('밴 목록에 추가하였습니다.');
    } catch (e) {
      return ('실패');
    }
  }

  // unban
  async commandUnban(client: Socket, channelId: number, target: string) {
    try {
      const user = await this.usersService.readOnePurePlayerWithName(target);
      if (!user)
        return ('존재하지 않는 유저입니다.');
      const chatBan = await this.chatsService.readChatBan(channelId, user.id);
      if (!chatBan)
        return ('밴 목록에 해당하는 유저가 없습니다.');
      this.chatsService.deleteBanInfo(chatBan.id);
      return ('밴 목록에서 제거하였습니다.');
    }
    catch (e) {
      return ('실패');
    }
  }

  // block
  async commandBlock(client: Socket, channelId: number, userId: number, target: string) {
    try {
      const userBlocks = await this.usersService.readBlockList(userId);
      if (target === '') {
        client.emit("BLOCK", userBlocks);
        return (null);
      }
      const user = await this.usersService.readOnePurePlayerWithName(target);
      if (!user)
        return ('존재하지 않는 유저입니다.');
      const blocked = userBlocks.find((e) => e.target.name === target);
      if (blocked)
        return ('이미 차단 목록에 추가된 유저입니다.');

      const userBlockRequest = {
        user: userId,
        target: user.id
      }
      this.usersService.createBlockInfo(userBlockRequest);
      return ('차단 목록에 추가하였습니다.');
    } catch (e) {
      return ('실패');
    }
  }
  // unblock
  async commandUnblock(client: Socket, channelId: number, userId: number, target: string) {
    try {
      const userBlocks = await this.usersService.readBlockList(userId);
      const user = await this.usersService.readOnePurePlayerWithName(target);
      if (!user)
        return ('존재하지 않는 유저입니다.');
      const blocked = userBlocks.find((e) => e.target.name === target);
      if (!blocked)
        return ('차단 목록에 해당하는 유저가 없습니다.');
      this.usersService.deleteBlockInfo(blocked.id);
      return ('차단 목록에서 제거하였습니다.');
    }
    catch (e) {
      return ('실패');
    }
  }

  checkMuteTime(chatMute: ChatMute) {
    const date = chatMute.date.getTime();
    const now = new Date().getTime();
    if (((now - date) / 1000) > 60) {
      return (true);
    }
    return (false);
  }

  // mute
  async commandMute(client: Socket, channelId: number, target: string) {
    try {
      const user = await this.usersService.readOnePurePlayerWithName(target);
      if (!user)
        return ('존재하지 않는 유저입니다.');
      const chatMute = await this.chatsService.readChatMute(channelId, user.id);
      const chatMuteRequest = {
        channelId: channelId,
        userId: user.id
      }
      if (chatMute) {
        if (this.checkMuteTime(chatMute)) {
          this.chatsService.deleteMuteInfo(chatMute.id);
          this.chatsService.createMuteInfo(chatMuteRequest);
          return ('해당 유저를 1분간 채팅 금지합니다.');
        }
        return ('이미 채팅 금지된 유저입니다.');
      }
      this.chatsService.createMuteInfo(chatMuteRequest);
      return ('해당 유저를 1분간 채팅 금지합니다.');
    } catch (e) {
      return ('실패');
    }
  }

  // name
  async commandName(client: Socket, channelId: number, target: string) {
    try {
      this.chatsService.updateChannelConfigWithTitle(channelId, target);
      // 유저한테 다시 채널 리스트 뿌리는 로직 필요
      // 
      return ('채팅방 이름을 변경하였습니다.');
    } catch (e) {
      return ('실패');
    }
  }

  // password
  async commandPassword(client: Socket, channelId: number, target: string) {
    try {
      let password = null;
      if (target !== undefined)
        password = target;
      this.chatsService.updateChannelPassword(channelId, password);
      return ('비밀번호가 성공적으로 변경되었습니다.');
    } catch (e) {
      return ('실패');
    }
  }

  async checkOpUser(client: Socket, message) {
    const { roomId } = client.data;
    const channelId = parseInt(roomId);
    const channelMember = await this.chatsService.readChannelMember(channelId, message.userId);

    if (!channelMember.op) {
      const msg = this.getInfoMessage('OP 권한이 필요합니다.');
      client.emit('MSG', msg);
    }
    return (channelMember.op);
  }
}

export class chatRoomListDTO {
  roomId: string;
  chat: ChannelConfig
}