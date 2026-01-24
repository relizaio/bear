import { Injectable } from '@nestjs/common'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta, LicenseData, SourceType } from 'src/model/Bommeta'
import * as CDX from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()
const AI_TYPE = process.env.BEAR_AI_TYPE // GEMINI or OPENAI
const GEMINI_API_KEY = process.env.BEAR_GEMINI_API_KEY
const OPENAI_API_KEY = process.env.BEAR_OPENAI_API_KEY

const SUPPLIER_NORMALIZATIONS: Record<string, {name: string, url: string}> = {
    'microsoft': { name: 'Microsoft Corporation', url: 'https://www.microsoft.com' },
}

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
            supplierSource: dbRow.supplier_source,
            license: dbRow.license,
            licenseSource: dbRow.license_source,
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
        const queryText = `INSERT INTO ${schema}.bommeta (uuid, purl, ecosystem, supplier, supplier_source, license, license_source, cdx_schema_version) values ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`
        const supplierJson = this.supplierToJson(bommeta.supplier)
        const queryParams = [bommeta.uuid, bommeta.purl, bommeta.ecosystem, JSON.stringify(supplierJson), bommeta.supplierSource, JSON.stringify(bommeta.license), bommeta.licenseSource, bommeta.cdxSchemaVersion]
        const queryRes = await runQuery(queryText, queryParams)
        return queryRes.rows[0]
    }

    async updateBomMeta (purl: string, supplier: CDX.Models.OrganizationalEntity, supplierSource: SourceType, license: LicenseData, licenseSource: SourceType) {
        const queryText = `UPDATE ${schema}.bommeta SET supplier = $2, supplier_source = $3, license = $4, license_source = $5, last_updated_date = now() WHERE purl = $1 RETURNING *`
        const supplierJson = this.supplierToJson(supplier)
        const queryParams = [purl, JSON.stringify(supplierJson), supplierSource, JSON.stringify(license), licenseSource]
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

    async createBomMeta (purlStr: string, supplier: CDX.Models.OrganizationalEntity, supplierSource: SourceType, license: LicenseData, licenseSource: SourceType) : Promise<BomMeta> {
        if (!purlStr) throw new TypeError("Purl is required for BEAR!")
        const purl = PackageURL.fromString(purlStr)
        const bommeta : BomMeta = new BomMeta()
        bommeta.cdxSchemaVersion = '1.7'
        bommeta.supplier = supplier
        bommeta.supplierSource = supplierSource
        bommeta.license = license
        bommeta.licenseSource = licenseSource
        bommeta.ecosystem = purl.type
        bommeta.purl = purlStr
        this.saveToDb(bommeta)
        return bommeta
    }

    async enrichByPurl (purlStr: string) {
        const dbRecord = await this.getBomMetaByPurl(purlStr)
        
        let supplier: CDX.Models.OrganizationalEntity = null
        let supplierSource: SourceType = null
        let license: LicenseData = null
        let licenseSource: SourceType = null
        
        // Check if we have both supplier and license in DB
        if (dbRecord && dbRecord.supplier && dbRecord.license) {
            return this.buildComponent(purlStr, dbRecord.supplier, dbRecord.license)
        }
        
        // Get existing values from DB if present
        if (dbRecord?.supplier) {
            supplier = dbRecord.supplier
            supplierSource = dbRecord.supplierSource
        }
        if (dbRecord?.license) {
            license = dbRecord.license
            licenseSource = dbRecord.licenseSource
        }
        
        // Check for AUTO resolution first (before ClearlyDefined)
        if (!supplier) {
            const normalized = this.getNormalizedSupplier(purlStr)
            if (normalized) {
                supplier = normalized
                supplierSource = SourceType.AUTO
            }
        }
        if (!license && purlStr.includes('Microsoft.AspNetCore')) {
            license = { id: 'MIT' }
            licenseSource = SourceType.AUTO
        }
        
        // If we still need supplier or license, try ClearlyDefined (single call)
        const needSupplierFromCD = !supplier
        const needLicenseFromCD = !license
        if (needSupplierFromCD || needLicenseFromCD) {
            const cdResult = await this.resolveOnClearlyDefined(purlStr)
            
            if (needSupplierFromCD && cdResult.supplier) {
                supplier = this.normalizeSupplier(cdResult.supplier)
                supplierSource = SourceType.CLEARLYDEFINED
            }
            if (needLicenseFromCD && cdResult.license && !cdResult.license.id?.includes('LicenseRef') && !cdResult.license.expression?.includes('LicenseRef')) {
                license = cdResult.license
                licenseSource = SourceType.CLEARLYDEFINED
            }
        }
        
        // Fallback to AI for anything still missing
        if (!supplier) {
            if (AI_TYPE === 'GEMINI') {
                supplier = this.normalizeSupplier(await this.resolveSupplierOnGemini(purlStr))
                supplierSource = SourceType.GEMINI
            } else {
                supplier = this.normalizeSupplier(await this.resolveSupplierOnOpenai(purlStr))
                supplierSource = SourceType.OPENAI
            }
        }
        if (!license) {
            if (AI_TYPE === 'GEMINI') {
                license = await this.resolveLicenseOnGemini(purlStr)
                licenseSource = SourceType.GEMINI
            } else {
                license = await this.resolveLicenseOnOpenai(purlStr)
                licenseSource = SourceType.OPENAI
            }
        }
        
        // Save or update DB record
        if (dbRecord) {
            await this.updateBomMeta(purlStr, supplier, supplierSource, license, licenseSource)
        } else {
            await this.createBomMeta(purlStr, supplier, supplierSource, license, licenseSource)
        }
        
        return this.buildComponent(purlStr, supplier, license)
    }

    private buildComponent (purlStr: string, supplier: CDX.Models.OrganizationalEntity, license: LicenseData) {
        let licenseChoice = null
        if (license) {
            if (license.expression) {
                licenseChoice = { expression: license.expression }
            } else {
                licenseChoice = { license: { id: license.id, name: license.name, url: license.url } }
            }
        }
        return {
            type: 'library',
            name: purlStr,
            purl: purlStr,
            supplier: supplier ? {
                name: supplier.name,
                url: Array.from(supplier.url)
            } : null,
            licenses: licenseChoice ? [licenseChoice] : []
        }
    }

    private getNormalizedSupplier (purlStr: string) : CDX.Models.OrganizationalEntity | null {
        const purlLower = purlStr.toLowerCase()
        for (const [key, value] of Object.entries(SUPPLIER_NORMALIZATIONS)) {
            if (purlLower.includes(key)) {
                const supplier = new CDX.Models.OrganizationalEntity({ name: value.name })
                supplier.url.add(value.url)
                return supplier
            }
        }
        return null
    }

    private normalizeSupplier (supplier: CDX.Models.OrganizationalEntity) : CDX.Models.OrganizationalEntity {
        if (!supplier || !supplier.name) return supplier
        const nameLower = supplier.name.toLowerCase()
        for (const [key, value] of Object.entries(SUPPLIER_NORMALIZATIONS)) {
            if (nameLower.includes(key)) {
                const normalized = new CDX.Models.OrganizationalEntity({ name: value.name })
                normalized.url.add(value.url)
                return normalized
            }
        }
        return supplier
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

    async resolveOnClearlyDefined (purlStr: string) : Promise<{supplier: CDX.Models.OrganizationalEntity, license: LicenseData}> {
        try {
            const url = this.buildClearlyDefinedUrl(purlStr)
            console.log(`Calling ClearlyDefined API: ${url}`)
            
            const resp: AxiosResponse = await axiosClient.get(url)
            
            let supplier: CDX.Models.OrganizationalEntity = null
            let license: LicenseData = null
            
            // Extract supplier from sourceLocation
            if (resp.data?.described?.sourceLocation) {
                const source = resp.data.described.sourceLocation
                if (source.provider === 'github') {
                    supplier = new CDX.Models.OrganizationalEntity({ name: source.namespace })
                    supplier.url.add(`https://github.com/${source.namespace}`)
                }
            }
            
            // Extract license
            if (resp.data?.licensed?.declared) {
                const declared = resp.data.licensed.declared
                if (declared.includes(' AND ') || declared.includes(' OR ')) {
                    license = { expression: declared }
                } else {
                    license = { id: declared }
                }
            }
            
            return { supplier, license }
        } catch (error) {
            console.error('Error calling ClearlyDefined API:', error.message)
            return { supplier: null, license: null }
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
            return this.parseLicenseResponse(respText)
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
            return this.parseLicenseResponse(respText)
        } catch (error) {
            console.error('Error calling OpenAI for license:', error.message)
            return null
        }
    }

    private parseLicenseResponse (licenseStr: string) : LicenseData {
        if (licenseStr.includes(' AND ') || licenseStr.includes(' OR ')) {
            return { expression: licenseStr }
        }
        return { id: licenseStr }
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
