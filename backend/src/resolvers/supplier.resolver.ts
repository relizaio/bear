import { Resolver, Mutation, Args } from '@nestjs/graphql'
import { Supplier } from 'src/graphql'
import { BomMetaService } from 'src/services/bommeta.service'
import CDX from "@cyclonedx/cyclonedx-library"

@Resolver('Supplier')
export class SupplierResolver {
    constructor(
            private bomMetaService: BomMetaService
    ) {}

    @Mutation()
    async resolveSupplier(@Args('purl') purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        return await this.bomMetaService.resolveSupplierByPurl(purl)
    }

}
