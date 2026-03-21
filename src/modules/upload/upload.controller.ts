import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';

type AuthedRequest = {
  user: { userId: string; role: string };
};

interface UploadResult {
  url: string;
  publicId: string;
  width: number;
  height: number;
  format: string;
}

@Controller('upload')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('STORE')
export class UploadController {
  constructor(private readonly configService: ConfigService) {
    // Configure Cloudinary
    cloudinary.config({
      cloud_name: this.configService.get('CLOUDINARY_CLOUD_NAME'),
      api_key: this.configService.get('CLOUDINARY_API_KEY'),
      api_secret: this.configService.get('CLOUDINARY_API_SECRET'),
    });
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max
      },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    try {
      // Upload to Cloudinary
      const result: UploadApiResponse = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            folder: `outfyt/stores/${req.user.userId}`,
            resource_type: 'image',
            transformation: [
              { width: 1200, height: 1200, crop: 'limit' },
              { quality: 'auto:good' },
            ],
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result!);
          },
        ).end(file.buffer);
      });

      return {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        format: result.format,
      };
    } catch (error: any) {
      console.error('Cloudinary upload error:', error);
      throw new BadRequestException('Failed to upload image: ' + (error.message || 'Unknown error'));
    }
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('files', {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max for bulk
      },
    }),
  )
  async uploadMultiple(
    @Req() req: AuthedRequest,
    @UploadedFile() files: Express.Multer.File,
  ): Promise<{ message: string }> {
    // Note: For multiple files, frontend should call /upload/image multiple times
    // or use a different approach with zip file
    throw new BadRequestException('Use /upload/image for each file individually');
  }

  @Post('bulk-images')
  @UseInterceptors(
    FileInterceptor('archive', {
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB max
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/zip', 'application/x-zip-compressed', 'application/x-zip'];
        const allowedExtensions = ['.zip'];
        const ext = file.originalname.toLowerCase().slice(-4);
        
        if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
          return cb(null, true);
        }
        return cb(new BadRequestException('Only ZIP archives are allowed'), false);
      },
    }),
  )
  async uploadBulkImages(
    @Req() req: AuthedRequest,
    @UploadedFile() archive: Express.Multer.File,
  ): Promise<{ images: Array<{ name: string; url: string }> }> {
    if (!archive) {
      throw new BadRequestException('No archive uploaded');
    }

    const AdmZip = await import('adm-zip');
    const zip = new AdmZip.default(archive.buffer);
    const entries = zip.getEntries();
    
    const results: Array<{ name: string; url: string }> = [];
    
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (!entry.entryName.match(/\.(jpg|jpeg|png|gif|webp)$/i)) continue;
      
      const imageBuffer = entry.getData();
      const imageName = entry.entryName.split('/').pop() || entry.entryName;
      
      try {
        const result: UploadApiResponse = await new Promise((resolve, reject) => {
          cloudinary.uploader.upload_stream(
            {
              folder: `outfyt/stores/${req.user.userId}/bulk`,
              resource_type: 'image',
              transformation: [
                { width: 1200, height: 1200, crop: 'limit' },
                { quality: 'auto:good' },
              ],
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result!);
            },
          ).end(imageBuffer);
        });
        
        results.push({
          name: imageName,
          url: result.secure_url,
        });
      } catch (error) {
        console.error(`Failed to upload ${imageName}:`, error);
      }
    }
    
    return { images: results };
  }
}
