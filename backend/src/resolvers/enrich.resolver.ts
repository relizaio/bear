import { Resolver, Mutation, Args } from '@nestjs/graphql'
import { UseGuards } from '@nestjs/common'
import { BomMetaService } from 'src/services/bommeta.service'
import { ApiKeyGuard } from 'src/guards/api-key.guard'

const MAX_BATCH_SIZE = 20

@Resolver('Component')
@UseGuards(ApiKeyGuard)
export class EnrichResolver {
    constructor(
            private bomMetaService: BomMetaService
    ) {}

    @Mutation()
    async enrich(@Args('purl') purl: string) {
        return await this.bomMetaService.enrichByPurl(purl)
    }

    @Mutation()
    async enrichBatch(@Args('purls') purls: string[]) {
        if (purls.length > MAX_BATCH_SIZE) {
            throw new Error(`Maximum batch size is ${MAX_BATCH_SIZE} purls`)
        }
        return await Promise.all(purls.map(purl => this.bomMetaService.enrichByPurl(purl)))
    }

}
