import { Injectable } from '@nestjs/common'
import { Supplier } from 'src/graphql'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta } from 'src/model/Bommeta'
import CDX, { Models } from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()
const GEMINI_API_KEY = process.env.BEAR_GEMINI_API_KEY

@Injectable()
export class BomMetaService {
    async getBomMeta (uuid: string) : Promise<BomMeta | undefined> {
        let bommeta: BomMeta = undefined
        const queryText = `SELECT * FROM ${schema}.bommeta where uuid = $1`
        const queryParams = [uuid]
        const queryRes = await runQuery(queryText, queryParams)
        if (queryRes.rows && queryRes.rows.length) bommeta = this.dbRowToBomMeta(queryRes.rows[0])
        return bommeta
    }

    private dbRowToBomMeta (dbRow: any) : BomMeta {
        const bommeta : BomMeta = {
            uuid: dbRow.uuid,
            createdDate: dbRow.created_date,
            lastUpdatedDate: dbRow.last_updated_date,
            ecosystem: dbRow.ecosystem,
            purl: dbRow.purl,
            supplier: dbRow.supplier,
            cdxSchemaVersion: dbRow.cdx_schema_version,
        }
        return bommeta
    }

    async getBomMetaByPurl (purl: string) : Promise<BomMeta | undefined> {
        let bommeta: BomMeta = undefined
        const queryText = `SELECT * FROM ${schema}.bommeta where purl = $1`
        const queryParams = [purl]
        const queryRes = await runQuery(queryText, queryParams)
        if (queryRes.rows && queryRes.rows.length) bommeta = this.dbRowToBomMeta(queryRes.rows[0])
        return bommeta
    }

    async saveToDb (bommeta: BomMeta) {
        const queryText = `INSERT INTO ${schema}.bommeta (uuid, purl, ecosystem, supplier, cdx_schema_version) values ($1, $2, $3, $4, $5) RETURNING *`
        const queryParams = [bommeta.uuid, bommeta.purl, bommeta.ecosystem, JSON.stringify(bommeta.supplier), bommeta.cdxSchemaVersion]
        const queryRes = await runQuery(queryText, queryParams)
        return queryRes.rows[0]
    }
    
    async createBomMeta (purlStr: string, supplier: CDX.Models.OrganizationalEntity, cdxSchemaVersion: string) : Promise<BomMeta> {
        if (!purlStr) throw new TypeError("Purl is required for BEAR!")
        const purl = PackageURL.fromString(purlStr)
        const bommeta : BomMeta = new BomMeta()
        bommeta.cdxSchemaVersion = cdxSchemaVersion
        bommeta.supplier = supplier
        bommeta.ecosystem = purl.type
        bommeta.purl = purlStr
        this.saveToDb(bommeta)
        return bommeta
    }

    async resolveSupplierByPurl (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        let supplier: CDX.Models.OrganizationalEntity = undefined
        const dbRecord = await this.getBomMetaByPurl(purl) 
        if (dbRecord) supplier = dbRecord.supplier
        else supplier = await this.resolveSupplierByPurlOnGemini(purl)
        return supplier
    }

    async resolveSupplierByPurlOnGemini (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        const resp: AxiosResponse = await axiosClient.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent',
            {
                contents: [{
                  "parts":[{"text": `can you give me only the supplier part of the CycloneDX JSON Component for ${purl} with no explanation`}]
                }]
            },
            {
                headers: {
                    'x-goog-api-key': GEMINI_API_KEY,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        )
        const respText = resp.data.candidates[0].content.parts[0].text
        console.log(respText)
        const respTextForParse = respText.replace('```json', '').replace('```', '')
        let parsedSupplier: any = JSON.parse(respTextForParse)
        if (parsedSupplier.supplier) parsedSupplier = parsedSupplier.supplier
        let url = undefined
        if (parsedSupplier.url && parsedSupplier.url.constructor === Array) {
            url = parsedSupplier.url
        } else if (parsedSupplier.url) {
            url = [parsedSupplier.url]
        } else {
            url = []
        }
        const cdxSupplierProps: CDX.Models.OptionalOrganizationalEntityProperties = {
            name: parsedSupplier.name,
            url,
            contact: parsedSupplier.contact
        }
        const cdxSupplier: CDX.Models.OrganizationalEntity = new Models.OrganizationalEntity(cdxSupplierProps)
        this.createBomMeta(purl, cdxSupplier, '1.6')
        return parsedSupplier
    }

}
