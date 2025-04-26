import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common'
import { GraphQLModule } from '@nestjs/graphql'
import { SupplierResolver } from './resolvers/supplier.resolver';
import { BomMetaService } from './services/bommeta.service';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: ['./**/*.graphql'],
      playground: (process.env.BEAR_ENABLE_PLAYGROUND === 'true') ? true : false
    }),
  ],
  controllers: [],
  providers: [BomMetaService, SupplierResolver],
})
export class AppModule {}
