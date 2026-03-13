import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { GqlExecutionContext } from '@nestjs/graphql'
import * as argon2 from 'argon2'

// Collect all API key hashes from env vars starting with or equal to BEAR_API_KEY_HASH
const API_KEY_HASHES = Object.keys(process.env)
    .filter(key => key === 'BEAR_API_KEY_HASH' || key.startsWith('BEAR_API_KEY_HASH_'))
    .map(key => process.env[key])
    .filter(value => value)

@Injectable()
export class ApiKeyGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        // Local mode - skip authentication if BEAR_API_KEY_HASH is 'local'
        if (process.env.BEAR_API_KEY_HASH === 'local') {
            return true
        }
        
        const ctx = GqlExecutionContext.create(context)
        const request = ctx.getContext().req
        
        const apiKey = request.headers['x-api-key']
        
        if (!apiKey) {
            throw new UnauthorizedException('Missing X-API-Key header')
        }
        
        // Try to verify against each hash until one matches
        for (const hash of API_KEY_HASHES) {
            try {
                const isValid = await argon2.verify(hash, apiKey)
                if (isValid) {
                    return true
                }
            } catch (error) {
                // Continue to next hash
            }
        }
        
        throw new UnauthorizedException('Invalid API key')
    }
}
