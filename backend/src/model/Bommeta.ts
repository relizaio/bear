import utils from "../utils/utils"
import CDX from "@cyclonedx/cyclonedx-library"

class BomMeta {
    uuid: string = utils.uuidv4()
    createdDate: Date = new Date()
    lastUpdatedDate: Date = new Date()
    purl: string = ''
    ecosystem: string = ''
    supplier: CDX.Models.OrganizationalEntity = undefined
    cdxSchemaVersion: string = '1.6'
}


export {
    BomMeta
}