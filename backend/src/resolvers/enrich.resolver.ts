import { Resolver, Mutation, Args } from '@nestjs/graphql'
import { BomMetaService } from 'src/services/bommeta.service'

@Resolver('Component')
export class EnrichResolver {
    constructor(
            private bomMetaService: BomMetaService
    ) {}

    @Mutation()
    async enrich(@Args('purl') purl: string) {
        return await this.bomMetaService.enrichByPurl(purl)
    }

}
