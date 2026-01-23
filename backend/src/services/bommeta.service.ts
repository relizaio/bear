import { Injectable } from '@nestjs/common'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta, LicenseData } from 'src/model/Bommeta'
import * as CDX from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()
const AI_TYPE = process.env.BEAR_AI_TYPE // GEMINI or OPENAI
const GEMINI_API_KEY = process.env.BEAR_GEMINI_API_KEY
const OPENAI_API_KEY = process.env.BEAR_OPENAI_API_KEY

@Injectable()
export class BomMetaService {

    private dbRowToBomMeta (dbRow: any) : BomMeta {
        const bommeta : BomMeta = {
            uuid: dbRow.uuid,
            createdDate: dbRow.created_date,
            lastUpdatedDate: dbRow.last_updated_date,
            ecosystem: dbRow.ecosystem,
            purl: dbRow.purl,
            supplier: dbRow.supplier ? new CDX.Models.OrganizationalEntity(dbRow.supplier) : undefined,
            license: dbRow.license,
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
        const queryText = `INSERT INTO ${schema}.bommeta (uuid, purl, ecosystem, supplier, license, cdx_schema_version) values ($1, $2, $3, $4, $5, $6) RETURNING *`
        const supplierJson = this.supplierToJson(bommeta.supplier)
        const queryParams = [bommeta.uuid, bommeta.purl, bommeta.ecosystem, JSON.stringify(supplierJson), JSON.stringify(bommeta.license), bommeta.cdxSchemaVersion]
        const queryRes = await runQuery(queryText, queryParams)
        return queryRes.rows[0]
    }

    async updateBomMeta (purl: string, supplier: CDX.Models.OrganizationalEntity, license: LicenseData) {
        const queryText = `UPDATE ${schema}.bommeta SET supplier = $2, license = $3, last_updated_date = now() WHERE purl = $1 RETURNING *`
        const supplierJson = this.supplierToJson(supplier)
        const queryParams = [purl, JSON.stringify(supplierJson), JSON.stringify(license)]
        const queryRes = await runQuery(queryText, queryParams)
        return queryRes.rows[0]
    }

    private supplierToJson (supplier: CDX.Models.OrganizationalEntity) {
        if (!supplier) return null
        return {
            name: supplier.name,
            url: Array.from(supplier.url),
            contact: Array.from(supplier.contact).map(c => ({ name: c.name, email: c.email, phone: c.phone }))
        }
    }

    async createBomMeta (purlStr: string, supplier: CDX.Models.OrganizationalEntity, license: LicenseData) : Promise<BomMeta> {
        if (!purlStr) throw new TypeError("Purl is required for BEAR!")
        const purl = PackageURL.fromString(purlStr)
        const bommeta : BomMeta = new BomMeta()
        bommeta.cdxSchemaVersion = '1.7'
        bommeta.supplier = supplier
        bommeta.license = license
        bommeta.ecosystem = purl.type
        bommeta.purl = purlStr
        this.saveToDb(bommeta)
        return bommeta
    }

    async enrichByPurl (purlStr: string) {
        const dbRecord = await this.getBomMetaByPurl(purlStr)
        
        let supplier: CDX.Models.OrganizationalEntity = null
        let license: LicenseData = null
        
        // Check if we have both supplier and license in DB
        if (dbRecord && dbRecord.supplier && dbRecord.license) {
            return this.buildComponent(purlStr, dbRecord.supplier, dbRecord.license)
        }
        
        // Resolve supplier if not in DB
        if (dbRecord && dbRecord.supplier) {
            supplier = dbRecord.supplier
        } else {
            supplier = await this.resolveSupplier(purlStr)
        }
        
        // Resolve license if not in DB
        if (dbRecord && dbRecord.license) {
            license = dbRecord.license
        } else {
            license = await this.resolveLicense(purlStr)
        }
        
        // Save or update DB record
        if (dbRecord) {
            await this.updateBomMeta(purlStr, supplier, license)
        } else {
            await this.createBomMeta(purlStr, supplier, license)
        }
        
        return this.buildComponent(purlStr, supplier, license)
    }

    private buildComponent (purlStr: string, supplier: CDX.Models.OrganizationalEntity, license: LicenseData) {
        return {
            type: 'library',
            name: purlStr,
            purl: purlStr,
            supplier: supplier ? {
                name: supplier.name,
                url: Array.from(supplier.url)
            } : null,
            licenses: license ? [{ license }] : []
        }
    }

    async resolveSupplier (purlStr: string) : Promise<CDX.Models.OrganizationalEntity> {
        // 1. Check if purl includes Microsoft - use "Microsoft Corporation"
        if (purlStr.includes('Microsoft')) {
            const supplier = new CDX.Models.OrganizationalEntity({ name: 'Microsoft Corporation' })
            supplier.url.add('https://www.microsoft.com')
            return supplier
        }
        
        // 2. Try ClearlyDefined
        const cdSupplier = await this.resolveSupplierOnClearlyDefined(purlStr)
        if (cdSupplier) {
            return cdSupplier
        }
        
        // 3. Fallback to AI
        if (AI_TYPE === 'GEMINI') {
            return await this.resolveSupplierOnGemini(purlStr)
        } else {
            return await this.resolveSupplierOnOpenai(purlStr)
        }
    }

    async resolveLicense (purlStr: string) : Promise<LicenseData> {
        // 1. Check if purl includes Microsoft.AspNetCore - return MIT
        if (purlStr.includes('Microsoft.AspNetCore')) {
            return { id: 'MIT' }
        }
        
        // 2. Try ClearlyDefined
        const cdLicense = await this.resolveLicenseOnClearlyDefined(purlStr)
        if (cdLicense) {
            return cdLicense
        }
        
        // 3. Fallback to AI
        if (AI_TYPE === 'GEMINI') {
            return await this.resolveLicenseOnGemini(purlStr)
        } else {
            return await this.resolveLicenseOnOpenai(purlStr)
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

    private buildClearlyDefinedUrl (purlStr: string) : string {
        const purl = PackageURL.fromString(purlStr)
        const { type, provider } = this.mapPurlTypeToClearlyDefined(purl.type)
        const namespace = purl.namespace || '-'
        const name = purl.name
        const revision = purl.version || '-'
        return `https://api.clearlydefined.io/definitions/${type}/${provider}/${namespace}/${name}/${revision}?expand=-files`
    }

    async resolveSupplierOnClearlyDefined (purlStr: string) : Promise<CDX.Models.OrganizationalEntity> {
        try {
            const url = this.buildClearlyDefinedUrl(purlStr)
            console.log(`Calling ClearlyDefined API for supplier: ${url}`)
            
            const resp: AxiosResponse = await axiosClient.get(url)
            
            if (resp.data && resp.data.described && resp.data.described.sourceLocation) {
                const source = resp.data.described.sourceLocation
                if (source.provider === 'github') {
                    const supplier = new CDX.Models.OrganizationalEntity({ name: source.namespace })
                    supplier.url.add(`https://github.com/${source.namespace}`)
                    return supplier
                }
            }
            return null
        } catch (error) {
            console.error('Error calling ClearlyDefined API for supplier:', error.message)
            return null
        }
    }

    async resolveLicenseOnClearlyDefined (purlStr: string) : Promise<LicenseData> {
        try {
            const url = this.buildClearlyDefinedUrl(purlStr)
            console.log(`Calling ClearlyDefined API for license: ${url}`)
            
            const resp: AxiosResponse = await axiosClient.get(url)
            
            if (resp.data && resp.data.licensed && resp.data.licensed.declared) {
                return { id: resp.data.licensed.declared }
            }
            return null
        } catch (error) {
            console.error('Error calling ClearlyDefined API for license:', error.message)
            return null
        }
    }

    async resolveSupplierOnGemini (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        try {
            const resp: AxiosResponse = await axiosClient.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
                {
                    contents: [{
                      "parts":[{"text": `Who is the supplier/vendor organization for the software package ${purl}? Return only a JSON object with fields: name (string), url (array of strings). No explanation.`}]
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
            console.log(`Gemini supplier response: ${respText}`)
            return this.parseSupplierResponse(respText)
        } catch (error) {
            console.error('Error calling Gemini for supplier:', error.message)
            return null
        }
    }

    async resolveSupplierOnOpenai (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        try {
            const resp: AxiosResponse = await axiosClient.post('https://api.openai.com/v1/responses',
                {
                    model: "gpt-5.2",
                    temperature: 0.2,
                    input: `Who is the supplier/vendor organization for the software package ${purl}? Return only a JSON object with fields: name (string), url (array of strings). No explanation.`
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
            console.log(`OpenAI supplier response: ${respText}`)
            return this.parseSupplierResponse(respText)
        } catch (error) {
            console.error('Error calling OpenAI for supplier:', error.message)
            return null
        }
    }

    async resolveLicenseOnGemini (purl: string) : Promise<LicenseData> {
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
            return { id: respText }
        } catch (error) {
            console.error('Error calling Gemini for license:', error.message)
            return null
        }
    }

    async resolveLicenseOnOpenai (purl: string) : Promise<LicenseData> {
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
            return { id: respText }
        } catch (error) {
            console.error('Error calling OpenAI for license:', error.message)
            return null
        }
    }

    private parseSupplierResponse (aiResponse: string) : CDX.Models.OrganizationalEntity {
        try {
            let respTextForParse = aiResponse.replace('```json', '').replace('```', '').trim()
            if (respTextForParse.charAt(0) !== '{') respTextForParse = '{' + respTextForParse + '}'
            let parsed: any = JSON.parse(respTextForParse)
            if (parsed.supplier) parsed = parsed.supplier
            
            const supplier = new CDX.Models.OrganizationalEntity({ name: parsed.name })
            if (parsed.url) {
                const urls = Array.isArray(parsed.url) ? parsed.url : [parsed.url]
                urls.forEach((u: string) => supplier.url.add(u))
            }
            return supplier
        } catch (error) {
            console.error('Error parsing supplier response:', error.message)
            return null
        }
    }

}
