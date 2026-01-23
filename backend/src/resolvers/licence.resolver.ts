import { Resolver, Mutation, Args } from '@nestjs/graphql'
import { BomMetaService } from 'src/services/bommeta.service'

@Resolver('LicenseChoice')
export class LicenceResolver {
    constructor(
            private bomMetaService: BomMetaService
    ) {}

    @Mutation()
    async resolveLicence(@Args('purl') purl: string) {
        return await this.bomMetaService.resolveLicenceByPurl(purl)
    }

}
