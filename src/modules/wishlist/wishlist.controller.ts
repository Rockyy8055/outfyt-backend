import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WishlistService } from './wishlist.service';

type AuthedRequest = {
  user: { userId: string; role: string };
};

@Controller('wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
  constructor(private readonly wishlistService: WishlistService) {}

  @Get()
  async getWishlist(@Req() req: AuthedRequest) {
    return this.wishlistService.getWishlist(req.user.userId);
  }

  @Get('count')
  async getWishlistCount(@Req() req: AuthedRequest) {
    const count = await this.wishlistService.getWishlistCount(req.user.userId);
    return { count };
  }

  @Post(':productId')
  async addToWishlist(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.addToWishlist(req.user.userId, productId);
  }

  @Delete(':productId')
  async removeFromWishlist(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
  ) {
    return this.wishlistService.removeFromWishlist(req.user.userId, productId);
  }

  @Get('check/:productId')
  async checkWishlist(
    @Req() req: AuthedRequest,
    @Param('productId') productId: string,
  ) {
    const isInWishlist = await this.wishlistService.isInWishlist(
      req.user.userId,
      productId,
    );
    return { isInWishlist };
  }
}
