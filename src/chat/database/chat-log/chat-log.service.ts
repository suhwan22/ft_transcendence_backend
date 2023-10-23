import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatLog } from './chat-log.entity';

@Injectable()
export class ChatLogService {
    constructor(
      @InjectRepository(ChatLog)
      private chatLogRepository: Repository<ChatLog>,
    ) {}

    async readChatLogList(channel: number): Promise<ChatLog[]> {
        return (this.chatLogRepository.find({ where: { channel } }));
    }

    async createChatLogInfo(chatLog: Partial<ChatLog>): Promise<ChatLog> {
        return (this.chatLogRepository.create(chatLog));
    }

    async updateCatLogInfo(id: number, chatLog: Partial<ChatLog>): Promise<ChatLog> {
        await this.chatLogRepository.update(id, chatLog);
        return (this.chatLogRepository.findOne({ where: { id } }));
    }

    async deleteCatLogInfo(id: number): Promise<void> {
        await this.chatLogRepository.delete(id);
    }
}
