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
                input: `Can you give me only the supplier part of the CycloneDX JSON Component for ${purl} with no explanation. Include url and contact details if possible. If no real email is known do not invent one.`
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

    async resolveLicenceByPurl (purlStr: string) : Promise<{license: {id?: string, name?: string, url?: string}}> {
        // Check if purl starts with Microsoft.AspNetCore - return MIT license
        if (purlStr.includes('Microsoft.AspNetCore')) {
            return {
                license: {
                    id: 'MIT'
                }
            }
        }
        // For other cases, call ClearlyDefined API first
        let licence = await this.resolveLicenceOnClearlyDefined(purlStr)
        // If ClearlyDefined fails, fallback to AI
        if (!licence) {
            if (AI_TYPE === 'GEMINI') {
                licence = await this.resolveLicenceByPurlOnGemini(purlStr)
            } else {
                licence = await this.resolveLicenceByPurlOnOpenai(purlStr)
            }
        }
        return licence
    }

    async resolveLicenceByPurlOnGemini (purl: string) : Promise<{license: {id?: string, name?: string, url?: string}}> {
        try {
            const resp: AxiosResponse = await axiosClient.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
                {
                    contents: [{
                      "parts":[{"text": `What is the SPDX license identifier for ${purl}? Return only the SPDX license ID with no explanation, e.g. MIT or Apache-2.0`}]
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
            const respText = resp.data.candidates[0].content.parts[0].text.trim()
            console.log(`Gemini license response: ${respText}`)
            return {
                license: {
                    id: respText
                }
            }
        } catch (error) {
            console.error('Error calling Gemini for license:', error.message)
            return null
        }
    }

    async resolveLicenceByPurlOnOpenai (purl: string) : Promise<{license: {id?: string, name?: string, url?: string}}> {
        try {
            const resp: AxiosResponse = await axiosClient.post('https://api.openai.com/v1/responses',
                {
                    model: "gpt-5.2",
                    temperature: 0.2,
                    input: `What is the SPDX license identifier for ${purl}? Return only the SPDX license ID with no explanation, e.g. MIT or Apache-2.0`
                },
                {
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }
                }
            )
            const respText = resp.data.output[0].content[0].text.trim()
            console.log(`OpenAI license response: ${respText}`)
            return {
                license: {
                    id: respText
                }
            }
        } catch (error) {
            console.error('Error calling OpenAI for license:', error.message)
            return null
        }
    }

    private mapPurlTypeToClearlyDefined (purlType: string) : {type: string, provider: string} {
        const mapping: Record<string, {type: string, provider: string}> = {
            'nuget': { type: 'nuget', provider: 'nuget' },
            'npm': { type: 'npm', provider: 'npmjs' },
            'maven': { type: 'maven', provider: 'mavencentral' },
            'pypi': { type: 'pypi', provider: 'pypi' },
            'gem': { type: 'gem', provider: 'rubygems' },
            'cargo': { type: 'crate', provider: 'cratesio' },
            'golang': { type: 'go', provider: 'golang' },
            'composer': { type: 'composer', provider: 'packagist' },
            'cocoapods': { type: 'pod', provider: 'cocoapods' },
            'github': { type: 'git', provider: 'github' },
        }
        return mapping[purlType] || { type: purlType, provider: purlType }
    }

    async resolveLicenceOnClearlyDefined (purlStr: string) : Promise<{license: {id?: string, name?: string, url?: string}}> {
        try {
            const purl = PackageURL.fromString(purlStr)
            const { type, provider } = this.mapPurlTypeToClearlyDefined(purl.type)
            const namespace = purl.namespace || '-'
            const name = purl.name
            const revision = purl.version || '-'
            
            const url = `https://api.clearlydefined.io/definitions/${type}/${provider}/${namespace}/${name}/${revision}?expand=-files`
            console.log(`Calling ClearlyDefined API: ${url}`)
            
            const resp: AxiosResponse = await axiosClient.get(url)
            
            if (resp.data && resp.data.licensed && resp.data.licensed.declared) {
                return {
                    license: {
                        id: resp.data.licensed.declared
                    }
                }
            }
            return null
        } catch (error) {
            console.error('Error calling ClearlyDefined API:', error.message)
            return null
        }
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
