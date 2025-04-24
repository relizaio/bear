import { Injectable } from '@nestjs/common'
import { Supplier } from 'src/graphql'
import { runQuery, schema } from '../utils/pgUtils'
import { BomMeta } from 'src/model/Bommeta'
import CDX from "@cyclonedx/cyclonedx-library"
import axios, { AxiosResponse } from 'axios'
import { PackageURL } from 'packageurl-js'

const axiosClient = axios.create()

@Injectable()
export class BomMetaService {
    async getBomMeta (uuid: string) : Promise<BomMeta> {
        const queryText = `SELECT * FROM ${schema}.bommeta where uuid = $1`
        const queryParams = [uuid]
        const queryRes = await runQuery(queryText, queryParams)
        const bommeta : BomMeta = {
            uuid: queryRes.rows[0].uuid,
            createdDate: queryRes.rows[0].created_date,
            lastUpdatedDate: queryRes.rows[0].last_updated_date,
            ecosystem: queryRes.rows[0].ecosystem,
            purl: queryRes.rows[0].purl,
            supplier: queryRes.rows[0].supplier,
            cdxSchemaVersion: queryRes.rows[0].cdx_schema_version,
        }
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
        const resp: AxiosResponse = await axiosClient.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyAs-HEkblcNuMg16zbHBKmOeLyUTG3B5F8',
            {
                contents: [{
                  "parts":[{"text": `can you give me only the supplier part of the CycloneDX JSON Component for ${purl} with no explanation`}]
                }]
            },
            {
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json'
                }
            }
        )
        const respText = resp.data.candidates[0].content.parts[0].text
        const respTextForParse = respText.replace('```json', '').replace('```', '')
        const parsedSupplier: CDX.Models.OrganizationalEntity = JSON.parse(respTextForParse)
        this.createBomMeta(purl, parsedSupplier, '1.6')
        return parsedSupplier
    }

}
