import { Injectable } from '@nestjs/common'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta, LicenseData, SourceType, SourcesData } from 'src/model/Bommeta'
import * as CDX from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()
const AI_TYPE = process.env.BEAR_AI_TYPE // GEMINI or OPENAI
const GEMINI_API_KEY = process.env.BEAR_GEMINI_API_KEY
const GEMINI_COPYRIGHT_MODEL = process.env.BEAR_GEMINI_COPYRIGHT_MODEL || 'gemini-2.0-flash'
const OPENAI_API_KEY = process.env.BEAR_OPENAI_API_KEY
const OPENAI_COPYRIGHT_MODEL = process.env.BEAR_OPENAI_COPYRIGHT_MODEL || 'gpt-5.2'
const CLEARLYDEFINED_API_URI = process.env.BEAR_CLEARLYDEFINED_API_URI || 'https://api.clearlydefined.io'
const IS_PUBLIC_CLEARLYDEFINED = CLEARLYDEFINED_API_URI === 'https://api.clearlydefined.io'

const SUPPLIER_NORMALIZATIONS: Record<string, {name: string, url: string}> = {
    'microsoft': { name: 'Microsoft', url: 'https://www.microsoft.com' },
}

// AI Prompts - DRY constants for both Gemini and OpenAI
// All prompts request JSON with a confidence field (0-1 float)
const CONFIDENCE_THRESHOLD = 0.6
const AI_PROMPTS = {
    supplier: (purl: string) => `You are a software package expert. Who is the supplier/vendor organization for the software package ${purl}?\n\nIMPORTANT: Return ONLY a JSON object with fields: name (string), url (array of strings), confidence (float 0 to 1 indicating your confidence). Example: {"name": "Acme Corp", "url": ["https://acme.com"], "confidence": 0.95}. If you cannot determine it, return {"confidence": 0}. No explanation, no markdown.`,
    license: (purl: string) => `You are a software package expert. What is the license for the software package ${purl}?\n\nIMPORTANT: Return ONLY a JSON object with fields: license (string, SPDX identifier e.g. MIT or Apache-2.0), confidence (float 0 to 1 indicating your confidence). Example: {"license": "MIT", "confidence": 0.95}. If you cannot determine it, return {"license": "UNKNOWN", "confidence": 0}. No explanation, no markdown.`,
    copyrightSelect: (purl: string, copyrightList: string) => `You are a software package expert. Which of the following copyright notices is correct for the software package ${purl}?\n\n${copyrightList}\n\nIMPORTANT: Return ONLY a JSON object with fields: copyright (string, the exact copyright text from the list above), confidence (float 0 to 1 indicating your confidence). Example: {"copyright": "Copyright (c) 2020 Acme Corp", "confidence": 0.9}. If you cannot determine it, return {"copyright": "UNKNOWN", "confidence": 0}. No explanation, no markdown.`,
    copyrightResolve: (purl: string) => `You are a software package expert with access to package metadata. What is the copyright notice for the software package ${purl}?\n\nIMPORTANT: Return ONLY a JSON object with fields: copyright (string, in the format "Copyright (c) YYYY Name"), confidence (float 0 to 1 indicating your confidence). Example: {"copyright": "Copyright (c) 2020 Acme Corp", "confidence": 0.9}. If you cannot determine it, return {"copyright": "UNKNOWN", "confidence": 0}. No explanation, no markdown.`
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
            cdxComponent: dbRow.cdx_component,
            sources: dbRow.sources,
            // Legacy fields (read-only)
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
        const queryText = `INSERT INTO ${schema}.bommeta (uuid, purl, ecosystem, cdx_component, sources, cdx_schema_version) values ($1, $2, $3, $4, $5, $6) RETURNING *`
        const queryParams = [bommeta.uuid, bommeta.purl, bommeta.ecosystem, JSON.stringify(bommeta.cdxComponent), JSON.stringify(bommeta.sources), bommeta.cdxSchemaVersion]
        const queryRes = await runQuery(queryText, queryParams)
        return queryRes.rows[0]
    }

    async updateBomMetaCdx (purl: string, cdxComponent: any, sources: SourcesData) {
        const queryText = `UPDATE ${schema}.bommeta SET cdx_component = $2, sources = $3, last_updated_date = now() WHERE purl = $1 RETURNING *`
        const queryParams = [purl, JSON.stringify(cdxComponent), JSON.stringify(sources)]
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

    async createBomMeta (purlStr: string, cdxComponent: any, sources: SourcesData) : Promise<BomMeta> {
        if (!purlStr) throw new TypeError("Purl is required for BEAR!")
        const purl = PackageURL.fromString(purlStr)
        const bommeta : BomMeta = new BomMeta()
        bommeta.cdxSchemaVersion = '1.7'
        bommeta.cdxComponent = cdxComponent
        bommeta.sources = sources
        bommeta.ecosystem = purl.type
        bommeta.purl = purlStr
        this.saveToDb(bommeta)
        return bommeta
    }

    async enrichByPurl (purlStr: string) {
        const dbRecord = await this.getBomMetaByPurl(purlStr)
        
        // 1. If cdx_component is fully populated in DB, return it directly
        if (dbRecord?.cdxComponent) {
            return dbRecord.cdxComponent
        }
        
        let supplier: CDX.Models.OrganizationalEntity = null
        let supplierSource: SourceType = null
        let license: LicenseData = null
        let licenseSource: SourceType = null
        let copyright: string = null
        let copyrightSource: SourceType = null
        
        // 2. If legacy supplier + license exist, use them (copyright was not in legacy data)
        if (dbRecord?.supplier) {
            supplier = dbRecord.supplier
            supplierSource = dbRecord.supplierSource
        }
        if (dbRecord?.license) {
            license = dbRecord.license
            licenseSource = dbRecord.licenseSource
        }
        
        // 3. Check for AUTO resolution first (before ClearlyDefined)
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
        
        // 4. If we still need supplier, license, or copyright, try ClearlyDefined (single call)
        const needSupplierFromCD = !supplier
        const needLicenseFromCD = !license
        const needCopyrightFromCD = !copyright
        let cdCopyrights: string[] = []
        
        if (needSupplierFromCD || needLicenseFromCD || needCopyrightFromCD) {
            const cdResult = await this.resolveOnClearlyDefined(purlStr)
            
            if (needSupplierFromCD && cdResult.supplier && !this.isInvalidValue(cdResult.supplier.name)) {
                supplier = this.normalizeSupplier(cdResult.supplier)
                supplierSource = SourceType.CLEARLYDEFINED
            }
            if (needLicenseFromCD && cdResult.license && !this.isInvalidLicense(cdResult.license)) {
                license = cdResult.license
                licenseSource = SourceType.CLEARLYDEFINED
            }
            if (needCopyrightFromCD && cdResult.copyrights && cdResult.copyrights.length > 0) {
                cdCopyrights = cdResult.copyrights
            }
        }
        
        // 5. Fallback to AI for supplier and license still missing
        if (!supplier) {
            supplier = this.normalizeSupplier(await this.resolveSupplier(purlStr))
            supplierSource = AI_TYPE === 'GEMINI' ? SourceType.GEMINI : SourceType.OPENAI
        }
        if (!license) {
            license = await this.resolveLicense(purlStr)
            licenseSource = AI_TYPE === 'GEMINI' ? SourceType.GEMINI : SourceType.OPENAI
        }
        
        // 6. Resolve copyright: NuGet -> ClearlyDefined -> AI
        if (!copyright) {
            // First, try NuGet for nuget packages
            const purl = PackageURL.fromString(purlStr)
            if (purl.type === 'nuget') {
                copyright = await this.resolveCopyrightOnNuget(purlStr)
                if (copyright) {
                    copyrightSource = SourceType.NUGET
                }
            }
            
            // If NuGet didn't provide copyright, check ClearlyDefined copyrights
            if (!copyright) {
                if (cdCopyrights.length === 1) {
                    // Exactly one copyright - use it directly
                    copyright = cdCopyrights[0]
                    copyrightSource = SourceType.CLEARLYDEFINED
                } else if (cdCopyrights.length > 1) {
                    // Multiple copyrights - ask AI to select the correct one
                    copyright = await this.selectCopyright(purlStr, cdCopyrights)
                    copyrightSource = SourceType.CLEARLYDEFINED
                }
            }
            
            // Final fallback to AI if no copyright found
            if (!copyright) {
                copyright = await this.resolveCopyright(purlStr)
                copyrightSource = AI_TYPE === 'GEMINI' ? SourceType.GEMINI : SourceType.OPENAI
            }
        }
        
        // 7. Build component and sources, save to new columns
        const cdxComponent = this.buildComponent(purlStr, supplier, license, copyright)
        const sources: SourcesData = {
            supplier: supplierSource,
            license: licenseSource,
            copyright: copyrightSource
        }
        
        if (dbRecord) {
            await this.updateBomMetaCdx(purlStr, cdxComponent, sources)
        } else {
            await this.createBomMeta(purlStr, cdxComponent, sources)
        }
        
        return cdxComponent
    }

    private buildComponent (purlStr: string, supplier: CDX.Models.OrganizationalEntity, license: LicenseData, copyright?: string) {
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
            licenses: licenseChoice ? [licenseChoice] : [],
            copyright: copyright || null
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

    private isInvalidValue (value: string) : boolean {
        if (!value) return true
        const invalid = ['OTHER', 'NOASSERTION', 'NONE']
        return invalid.includes(value.toUpperCase())
    }

    private isInvalidLicense (license: LicenseData) : boolean {
        const checkValue = license.id || license.expression || ''
        return this.isInvalidValue(checkValue) || checkValue.includes('LicenseRef') || checkValue.includes('OTHER')
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

    private buildClearlyDefinedUrl (purlStr: string, baseUrl?: string) : string {
        const purl = PackageURL.fromString(purlStr)
        const { type, provider } = this.mapPurlTypeToClearlyDefined(purl.type)
        const namespace = purl.namespace || '-'
        const name = purl.name
        const revision = purl.version || '-'
        const apiUri = baseUrl || CLEARLYDEFINED_API_URI
        return `${apiUri}/definitions/${type}/${provider}/${namespace}/${name}/${revision}?expand=-files`
    }

    private buildClearlyDefinedCoordinates (purlStr: string) : string {
        const purl = PackageURL.fromString(purlStr)
        const { type, provider } = this.mapPurlTypeToClearlyDefined(purl.type)
        const namespace = purl.namespace || '-'
        const name = purl.name
        const revision = purl.version || '-'
        return `${type}/${provider}/${namespace}/${name}/${revision}`
    }

    private async sleep (ms: number) : Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    private hasValidScore (data: any) : boolean {
        return data?.described?.score?.total > 0 || data?.licensed?.score?.total > 0
    }

    private isInvalidResponse (response: string) : boolean {
        const lowerResponse = response.toLowerCase()
        // Treat presence of single quote as invalid (AI is explaining rather than returning data)
        if (response.includes("’")) {
            return true
        }
        const invalidPhrases = [
            "can't determine",
            "cannot determine",
            "unable to determine",
            "don't have access",
            "do not have access",
            "without access",
            "need access",
            "i don't know",
            "i do not know",
            "i'm unable",
            "i am unable",
            "not available",
            "no information"
        ]
        return invalidPhrases.some(phrase => lowerResponse.includes(phrase))
    }

    private parseAiJson (rawText: string) : any | null {
        // Run invalid response check on raw AI text as additional guard
        if (this.isInvalidResponse(rawText)) {
            console.log('AI response contains invalid phrases, treating as invalid. Raw:', rawText)
            return null
        }
        let text = rawText.trim().replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
        try {
            const parsed = JSON.parse(text)
            const confidence = parsed.confidence
            console.log(`AI confidence: ${confidence}`)
            if (typeof confidence !== 'number' || confidence < CONFIDENCE_THRESHOLD) {
                console.log(`AI confidence ${confidence} is below threshold ${CONFIDENCE_THRESHOLD}, treating as invalid`)
                return null
            }
            delete parsed.confidence
            return parsed
        } catch (error) {
            console.error('Failed to parse AI JSON response:', error.message, 'Raw:', rawText)
            return null
        }
    }

    private async triggerHarvestAndRetry (purlStr: string, url: string) : Promise<AxiosResponse> {
        console.debug('Score is zero, triggering harvest...')
        const coordinates = this.buildClearlyDefinedCoordinates(purlStr)
        const harvestUrl = `${CLEARLYDEFINED_API_URI}/harvest`
        const harvestPayload = [{ coordinates }]
        
        try {
            console.debug(`Harvest POST request: ${harvestUrl}`)
            console.debug(`Harvest payload: ${JSON.stringify(harvestPayload)}`)
            
            await axiosClient.post(harvestUrl, harvestPayload, 
                { headers: { 'Content-Type': 'application/json' } }
            )
            console.debug('Harvest triggered, waiting for processing...')
            
            const tries = 5;
            for (let i = 0; i < tries; i++) {
                await this.sleep(6000)
                const resp = await axiosClient.get(url + "&force=true")
                
                if (this.hasValidScore(resp.data)) {
                    console.debug(`Valid score received after ${i + 1} retries`)
                    return resp
                }
                console.debug(`Retry ${i + 1}/${tries}: Still no valid score`)
                
                // After 1st retry, try public ClearlyDefined API with 10s timeout
                if (i === 0) {
                    try {
                        const publicUrl = this.buildClearlyDefinedUrl(purlStr, 'https://api.clearlydefined.io')
                        console.log(`Calling public ClearlyDefined API: ${publicUrl}`)
                        const publicResp = await axiosClient.get(publicUrl, { timeout: 10000 })
                        
                        if (this.hasValidScore(publicResp.data)) {
                            console.log('Public ClearlyDefined API returned valid score, using that')
                            return publicResp
                        }
                        console.log('Public ClearlyDefined API has no valid score either, continuing retries')
                    } catch (publicError) {
                        console.error('Error calling public ClearlyDefined API:', publicError.message)
                    }
                }
            }
            
            // Fall back to original URL
            return await axiosClient.get(url)
        } catch (harvestError) {
            console.error('Error triggering harvest:', harvestError.message)
            return await axiosClient.get(url)
        }
    }

    async resolveOnClearlyDefined (purlStr: string) : Promise<{supplier: CDX.Models.OrganizationalEntity, license: LicenseData, copyrights: string[]}> {
        try {
            const url = this.buildClearlyDefinedUrl(purlStr)
            console.log(`Calling ClearlyDefined API: ${url}`)
            
            let resp: AxiosResponse = await axiosClient.get(url)
            
            // If using non-public API and score is all zeros, trigger harvest and retry
            if (!IS_PUBLIC_CLEARLYDEFINED && !this.hasValidScore(resp.data)) {
                resp = await this.triggerHarvestAndRetry(purlStr, url)
            }
            
            let supplier: CDX.Models.OrganizationalEntity = null
            let license: LicenseData = null
            let copyrights: string[] = []
            
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
            
            // Extract copyrights from facets.core.attribution.parties
            if (resp.data?.licensed?.facets?.core?.attribution?.parties) {
                copyrights = resp.data.licensed.facets.core.attribution.parties
            }
            
            return { supplier, license, copyrights }
        } catch (error) {
            console.error('Error calling ClearlyDefined API:', error.message)
            return { supplier: null, license: null, copyrights: [] }
        }
    }

    private async callGemini (prompt: string, model?: string) : Promise<string> {
        const geminiModel = model || 'gemini-2.0-flash'
        const resp: AxiosResponse = await axiosClient.post(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`,
            {
                contents: [{
                  "parts":[{"text": prompt}]
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
        return resp.data.candidates[0].content.parts[0].text.trim()
    }

    private async callOpenai (prompt: string, model?: string, reasoning?: { effort: string }) : Promise<string> {
        const openaiModel = model || 'gpt-5.2'
        const body: any = { model: openaiModel, input: prompt }
        if (reasoning) {
            body.reasoning = reasoning
        } else {
            body.temperature = 0.2
        }
        const resp: AxiosResponse = await axiosClient.post('https://api.openai.com/v1/responses',
            body,
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        )
        // Find the message object in the output array (skip reasoning objects)
        const messageOutput = resp.data.output.find((item: any) => item.type === 'message')
        if (!messageOutput || !messageOutput.content || messageOutput.content.length === 0) {
            throw new Error('No message content found in OpenAI response')
        }
        return messageOutput.content[0].text.trim()
    }

    private async callAi (prompt: string, model?: string, reasoning?: { effort: string }) : Promise<string> {
        if (AI_TYPE === 'GEMINI') {
            return this.callGemini(prompt, model)
        } else {
            return this.callOpenai(prompt, model, reasoning)
        }
    }

    async resolveSupplier (purl: string) : Promise<CDX.Models.OrganizationalEntity> {
        try {
            const respText = await this.callAi(AI_PROMPTS.supplier(purl))
            console.log(`AI supplier response: ${respText}`)
            const parsed = this.parseAiJson(respText)
            if (!parsed || !parsed.name) {
                console.log('AI supplier response is invalid or low confidence, returning null')
                return null
            }
            const supplier = new CDX.Models.OrganizationalEntity({ name: parsed.name })
            if (parsed.url) {
                const urls = Array.isArray(parsed.url) ? parsed.url : [parsed.url]
                urls.forEach((u: string) => supplier.url.add(u))
            }
            return supplier
        } catch (error) {
            console.error('Error calling AI for supplier:', error.message)
            return null
        }
    }

    async resolveLicense (purl: string) : Promise<LicenseData> {
        try {
            const respText = await this.callAi(AI_PROMPTS.license(purl))
            console.log(`AI license response: ${respText}`)
            const parsed = this.parseAiJson(respText)
            if (!parsed || !parsed.license || parsed.license === 'UNKNOWN') {
                console.log('AI license response is invalid or low confidence, returning null')
                return null
            }
            return this.parseLicenseResponse(parsed.license)
        } catch (error) {
            console.error('Error calling AI for license:', error.message)
            return null
        }
    }

    async resolveCopyrightOnNuget (purlStr: string) : Promise<string> {
        try {
            const purl = PackageURL.fromString(purlStr)
            if (purl.type !== 'nuget') {
                return null
            }
            
            const packageName = purl.name.toLowerCase()
            const version = purl.version
            
            // Step 1: Get package registration
            const registrationUrl = `https://api.nuget.org/v3/registration5-gz-semver2/${packageName}/${version}.json`
            const registrationResp: AxiosResponse = await axiosClient.get(registrationUrl, {
                headers: { 'Accept-Encoding': 'gzip, deflate' }
            })
            
            if (!registrationResp.data?.catalogEntry) {
                console.log(`No catalogEntry found for NuGet package ${packageName}@${version}`)
                return null
            }
            
            // Step 2: Get catalog entry
            const catalogUrl = registrationResp.data.catalogEntry
            const catalogResp: AxiosResponse = await axiosClient.get(catalogUrl, {
                headers: { 'Accept-Encoding': 'gzip, deflate' }
            })
            
            const copyright = catalogResp.data?.copyright
            if (copyright) {
                console.log(`NuGet copyright for ${packageName}@${version}: ${copyright}`)
                return copyright
            }
            
            console.log(`No copyright found in NuGet catalog for ${packageName}@${version}`)
            return null
        } catch (error) {
            console.error('Error calling NuGet API for copyright:', error.message)
            return null
        }
    }

    async selectCopyright (purl: string, copyrights: string[]) : Promise<string> {
        try {
            const copyrightList = copyrights.map((c, i) => `${i + 1}. ${c}`).join('\n')
            const copyrightModel = AI_TYPE === 'GEMINI' ? GEMINI_COPYRIGHT_MODEL : OPENAI_COPYRIGHT_MODEL
            const respText = await this.callAi(AI_PROMPTS.copyrightSelect(purl, copyrightList), copyrightModel, { effort: "medium" })
            console.log(`AI selected copyright: ${respText}`)
            const parsed = this.parseAiJson(respText)
            if (!parsed || !parsed.copyright || parsed.copyright === 'UNKNOWN') {
                console.log('AI copyright selection is invalid or low confidence, returning null')
                return null
            }
            return parsed.copyright
        } catch (error) {
            console.error('Error calling AI for copyright selection:', error.message)
            return null
        }
    }

    async resolveCopyright (purl: string) : Promise<string> {
        try {
            const copyrightModel = AI_TYPE === 'GEMINI' ? GEMINI_COPYRIGHT_MODEL : OPENAI_COPYRIGHT_MODEL
            const respText = await this.callAi(AI_PROMPTS.copyrightResolve(purl), copyrightModel, { effort: "medium" })
            console.log(`AI copyright response: ${respText}`)
            const parsed = this.parseAiJson(respText)
            if (!parsed || !parsed.copyright || parsed.copyright === 'UNKNOWN') {
                console.log('AI copyright response is invalid or low confidence, returning null')
                return null
            }
            return parsed.copyright
        } catch (error) {
            console.error('Error calling AI for copyright:', error.message)
            return null
        }
    }

    private parseLicenseResponse (licenseStr: string) : LicenseData {
        if (licenseStr.includes(' AND ') || licenseStr.includes(' OR ')) {
            return { expression: licenseStr }
        }
        return { id: licenseStr }
    }

}
