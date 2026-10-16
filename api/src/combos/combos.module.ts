import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CombosController } from './combos.controller';
import { CombosService } from './combos.service';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [CombosController],
  providers: [CombosService],
  exports: [CombosService]
})
export class CombosModule {}
