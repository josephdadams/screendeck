import http, { Server } from 'http'
import { store } from './store'
import { applyCompanionConnectionSettings } from './utils'

// Minimal REST config server, matching the subset of bitfocus/companion-satellite's
// own configuration API (see its openapi.yaml) that Companion's Surfaces > Outbound
// "Discover" UI needs to show status and push a new Companion address (#4). No
// authentication, same tradeoff the reference app makes - it's opt-in via Settings
// and disclosed in this feature's PR description.

let server: Server | null = null

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    const data = JSON.stringify(body)
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
    })
    res.end(data)
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = ''
        req.on('data', (chunk) => {
            data += chunk
            // Guard against unbounded bodies from a misbehaving/malicious client
            if (data.length > 1_000_000) {
                req.destroy()
                reject(new Error('Request body too large'))
            }
        })
        req.on('end', () => resolve(data))
        req.on('error', reject)
    })
}

function getConfig() {
    return {
        protocol: 'tcp' as const,
        host: store.get('companionIP', '127.0.0.1') as string,
        port: store.get('companionPort', 16622) as number,
        wsAddress: '',
        installationName: store.get('installationName', '') as string,
        mdnsEnabled: store.get('mdnsEnabled', true) as boolean,
        httpEnabled: store.get('restEnabled', true) as boolean,
        httpPort: store.get('restPort', 9999) as number,
    }
}

async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
) {
    const url = req.url ?? '/'

    if (req.method === 'GET' && url === '/status') {
        const client = global.satelliteClient
        sendJson(res, 200, {
            connected: client?.connected ?? false,
            companionVersion: client?.companionVersion ?? null,
            companionApiVersion: client?.companionApiVersion ?? null,
            companionUnsupportedApi: client?.companionUnsupported ?? false,
        })
        return
    }

    if (req.method === 'GET' && url === '/config') {
        sendJson(res, 200, getConfig())
        return
    }

    if (req.method === 'POST' && url === '/config') {
        let body: Record<string, unknown>
        try {
            const raw = await readBody(req)
            body = raw ? JSON.parse(raw) : {}
        } catch (e) {
            sendJson(res, 400, { error: 'Invalid JSON body' })
            return
        }

        if (body.protocol !== undefined && body.protocol !== 'tcp') {
            sendJson(res, 400, {
                error: "Only the 'tcp' protocol is supported by ScreenDeck",
            })
            return
        }

        const update: Record<string, unknown> = {}
        if (typeof body.host === 'string') update.companionIP = body.host
        if (typeof body.port === 'number') update.companionPort = body.port
        if (typeof body.installationName === 'string')
            update.installationName = body.installationName
        if (typeof body.mdnsEnabled === 'boolean')
            update.mdnsEnabled = body.mdnsEnabled

        applyCompanionConnectionSettings(update)

        sendJson(res, 200, getConfig())
        return
    }

    sendJson(res, 404, { error: 'Not found' })
}

export function startRestServer() {
    if (!store.get('restEnabled', true)) return
    if (server) return

    const port = store.get('restPort', 9999) as number

    server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
            console.error('[RestServer] Unhandled error:', err)
            sendJson(res, 400, { error: 'Internal error' })
        })
    })

    server.on('error', (err) => {
        console.error('[RestServer] Failed to start:', err)
        server = null
    })

    server.listen(port, '0.0.0.0', () => {
        console.log(`[RestServer] Listening on 0.0.0.0:${port}`)
    })
}

export function stopRestServer() {
    if (server) {
        server.close()
        server = null
    }
}

let restartTimer: NodeJS.Timeout | undefined
function debouncedRestart() {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
        stopRestServer()
        startRestServer()
    }, 50)
}

// Restart the server whenever a relevant setting changes (e.g. from the
// Settings UI or the REST /config route itself), so a live toggle/port
// change takes effect immediately without an app restart.
export function watchRestServerSettings() {
    store.onDidChange('restEnabled', debouncedRestart)
    store.onDidChange('restPort', debouncedRestart)
}
