import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { GqlExecutionContext } from '@nestjs/graphql'
import * as argon2 from 'argon2'

const API_KEY_HASH = process.env.BEAR_API_KEY_HASH

@Injectable()
export class ApiKeyGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const ctx = GqlExecutionContext.create(context)
        const request = ctx.getContext().req
        
        const apiKey = request.headers['x-api-key']
        
        if (!apiKey) {
            throw new UnauthorizedException('Missing X-API-Key header')
        }
        
        try {
            const isValid = await argon2.verify(API_KEY_HASH, apiKey)
            if (!isValid) {
                throw new UnauthorizedException('Invalid API key')
            }
            return true
        } catch (error) {
            throw new UnauthorizedException('Invalid API key')
        }
    }
}
