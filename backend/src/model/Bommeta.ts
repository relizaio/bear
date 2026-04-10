import utils from "../utils/utils"
import CDX from "@cyclonedx/cyclonedx-library"

interface SupplierData {
    name?: string
    url?: string[]
    contact?: {name?: string, email?: string, phone?: string}[]
    address?: {country?: string, region?: string, locality?: string, postOfficeBoxNumber?: string, postalCode?: string, streetAddress?: string}
}

interface LicenseData {
    id?: string
    name?: string
    url?: string
    expression?: string
}

enum SourceType {
    AUTO = 'AUTO',
    CLEARLYDEFINED = 'CLEARLYDEFINED',
    DEPSDEV = 'DEPSDEV',
    NUGET = 'NUGET',
    OPENAI = 'OPENAI',
    GEMINI = 'GEMINI'
}

interface SourcesData {
    supplier?: SourceType
    license?: SourceType
    copyright?: SourceType
}

class BomMeta {
    uuid: string = utils.uuidv4()
    createdDate: Date = new Date()
    lastUpdatedDate: Date = new Date()
    purl: string = ''
    ecosystem: string = ''
    // New fields
    cdxComponent: any = undefined
    sources: SourcesData = undefined
    // Legacy fields (read-only, for backward compatibility)
    supplier: CDX.Models.OrganizationalEntity = undefined
    supplierSource: SourceType = undefined
    license: LicenseData = undefined
    licenseSource: SourceType = undefined
    cdxSchemaVersion: string = '1.7'
}


export {
    BomMeta,
    SupplierData,
    LicenseData,
    SourceType,
    SourcesData,
    CDX
}