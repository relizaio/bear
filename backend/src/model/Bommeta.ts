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
}

class BomMeta {
    uuid: string = utils.uuidv4()
    createdDate: Date = new Date()
    lastUpdatedDate: Date = new Date()
    purl: string = ''
    ecosystem: string = ''
    supplier: CDX.Models.OrganizationalEntity = undefined
    license: LicenseData = undefined
    cdxSchemaVersion: string = '1.7'
}


export {
    BomMeta,
    SupplierData,
    LicenseData,
    CDX
}