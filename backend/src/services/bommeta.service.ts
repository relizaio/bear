import { Injectable } from '@nestjs/common'
import { Supplier } from 'src/graphql'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta } from 'src/model/Bommeta'
import CDX, { Models } from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()
const AI_TYPE = process.env.BEAR_AI_TYPE // GEMINI or OPENAI
const GEMINI_API_KEY = process.env.BEAR_GEMINI_API_KEY
const OPENAI_API_KEY = process.env.BEAR_OPENAI_API_KEY

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
        else {
            if (AI_TYPE === 'GEMINI') {
                supplier = await this.resolveSupplierByPurlOnGemini(purl)
            } else {
                supplier = await this.resolveSupplierByPurlOnOpenai(purl)
            }
        }    
        return supplier
    }

    async resolveSupplierByPurlOnGemini (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        const resp: AxiosResponse = await axiosClient.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
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
        const cdxSupplier = this.parseAiResponseIntoCDX(respText)
        this.createBomMeta(purl, cdxSupplier, '1.6')
        return cdxSupplier
    }

    async resolveSupplierByPurlOnOpenai (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        const resp: AxiosResponse = await axiosClient.post('https://api.openai.com/v1/responses',
            {
                model: "gpt-4.1",
                temperature: 0.2,
                input: `Can you give me only the supplier part of the CycloneDX JSON Component for ${purl} with no explanation. Include url and contact details if possible.`
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        )
        const respText = resp.data.output[0].content[0].text
        console.log(respText)
        const cdxSupplier = this.parseAiResponseIntoCDX(respText)
        this.createBomMeta(purl, cdxSupplier, '1.6')
        return cdxSupplier
    }

    parseAiResponseIntoCDX (aiResponse: string) : CDX.Models.OrganizationalEntity {
        let respTextForParse = aiResponse.replace('```json', '').replace('```', '').trim()
        if (respTextForParse.charAt(0) !== '{') respTextForParse = '{' + respTextForParse + '}'
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
        let contact = undefined
        if (parsedSupplier.contact && parsedSupplier.contact.constructor === Array) {
            contact = parsedSupplier.contact
        } else if (parsedSupplier.contact) {
            contact = [parsedSupplier.contact]
        } else {
            contact = []
        }
        const cdxSupplierProps: CDX.Models.OptionalOrganizationalEntityProperties = {
            name: parsedSupplier.name,
            url,
            contact
        }
        const cdxSupplier: CDX.Models.OrganizationalEntity = new Models.OrganizationalEntity(cdxSupplierProps)
        return cdxSupplier
    }

}
