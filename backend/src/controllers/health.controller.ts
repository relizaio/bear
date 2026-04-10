import { Controller, Get, Res } from '@nestjs/common'
import { Response } from 'express'
import { runQuery } from '../utils/pgUtils'

@Controller()
export class HealthController {

    @Get('healthCheck')
    async healthCheck(@Res() res: Response) {
        try {
            await runQuery('SELECT 1', [])
            res.status(200).send('OK')
        } catch (error) {
            res.status(503).send('Service Unavailable')
        }
    }

}
