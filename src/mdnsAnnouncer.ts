import { Bonjour, Service } from '@julusian/bonjour-service'
import { store } from './store'

// Advertises this ScreenDeck install over mDNS so it shows up in Companion's
// Surfaces > Outbound "Discover" UI (#4). Mirrors bitfocus/companion-satellite's
// own mdnsAnnouncer.ts (same service type/shape) so Companion's existing
// discovery code recognizes it without any changes on Companion's side.

const bonjour = new Bonjour()
let service: Service | null = null

export function startMdnsAnnouncer() {
    if (!store.get('mdnsEnabled', true)) return
    if (service) return

    try {
        const installationName = store.get(
            'installationName',
            'ScreenDeck'
        ) as string
        const restPort = store.get('restPort', 9999) as number
        const restEnabled = store.get('restEnabled', true) as boolean

        service = bonjour.publish(
            {
                name: installationName,
                type: 'companion-satellite',
                protocol: 'tcp',
                port: restPort,
                txt: { restEnabled },
                ttl: 150,
            },
            {
                announceOnInterval: 60 * 1000,
            }
        )
    } catch (e) {
        console.error('[MdnsAnnouncer] Failed to publish mdns service', e)
    }
}

export function stopMdnsAnnouncer() {
    if (service) {
        service.stop?.()
        service = null
    }
}

let restartTimer: NodeJS.Timeout | undefined
function debouncedRestart() {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
        stopMdnsAnnouncer()
        startMdnsAnnouncer()
    }, 50)
}

export function watchMdnsAnnouncerSettings() {
    store.onDidChange('mdnsEnabled', debouncedRestart)
    store.onDidChange('installationName', debouncedRestart)
    store.onDidChange('restPort', debouncedRestart)
    store.onDidChange('restEnabled', debouncedRestart)
}
