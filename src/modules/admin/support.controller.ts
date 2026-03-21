import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { IsString, IsOptional, IsEnum, IsNumberString } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

class CreateTicketDto {
  @IsString()
  subject!: string;

  @IsString()
  message!: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  orderId?: string;
}

class TicketFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('ticket')
  async createTicket(@Body() dto: CreateTicketDto, @Req() req: AuthedRequest) {
    const ticket = await this.prisma.ticket.create({
      data: {
        userId: req.user.userId,
        subject: dto.subject,
        message: dto.message,
        type: dto.type as any,
        orderId: dto.orderId,
      },
    });

    return { success: true, data: ticket };
  }

  @Get('tickets')
  async getMyTickets(@Query() filters: TicketFilterDto, @Req() req: AuthedRequest) {
    const page = parseInt(filters.page || '1', 10);
    const limit = parseInt(filters.limit || '20', 10);
    const skip = (page - 1) * limit;

    const where: any = { userId: req.user.userId };
    if (filters.status) {
      where.status = filters.status;
    }

    const [tickets, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include: {
          assignee: { select: { id: true, name: true } },
          _count: { select: { replies: true } },
        },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      success: true,
      data: tickets,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  @Get('ticket/:id')
  async getTicket(@Param('id') id: string, @Req() req: AuthedRequest) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, userId: req.user.userId },
      include: {
        assignee: { select: { id: true, name: true } },
        replies: {
          where: { isInternal: false },
          include: { user: { select: { id: true, name: true, role: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    return { success: true, data: ticket };
  }

  @Post('ticket/:id/reply')
  async replyToTicket(
    @Param('id') id: string,
    @Body() body: { message: string },
    @Req() req: AuthedRequest,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, userId: req.user.userId },
    });

    if (!ticket) {
      throw new Error('Ticket not found');
    }

    if (ticket.status === 'CLOSED') {
      throw new Error('Cannot reply to closed ticket');
    }

    const reply = await this.prisma.ticketReply.create({
      data: {
        ticketId: id,
        userId: req.user.userId,
        message: body.message,
        isInternal: false,
      },
    });

    return { success: true, data: reply };
  }
}
