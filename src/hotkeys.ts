import { globalShortcut } from 'electron'
import { store } from './store'

export function registerHotkey(
    hotkey: string,
    deviceId: string,
    keyIndex: number
): boolean {
    if (globalShortcut.isRegistered(hotkey)) {
        console.warn(`Hotkey ${hotkey} is already in use`)
        return false
    }

    try {
        const columnCount = store.get(
            `device.${deviceId}.columnCount`,
            8
        ) as number
        const x = keyIndex % columnCount
        const y = Math.floor(keyIndex / columnCount)

        globalShortcut.register(hotkey, () => {
            global.satelliteClient?.keyDownXY(deviceId, x, y)
            setTimeout(
                () => global.satelliteClient?.keyUpXY(deviceId, x, y),
                100
            )
        })

        let imageBase64 = ''
        const deviceMap = global.keyStates.get(deviceId)

        if (deviceMap) {
            const keyState = deviceMap.get(keyIndex)

            if (keyState) {
                imageBase64 = keyState.imageBase64 || ''
            }
        }

        global.registeredHotkeys.set(hotkey, {
            deviceId,
            keyIndex,
            imageBase64: '',
        })
        console.log(
            `Registered hotkey: ${hotkey} for ${deviceId} key ${keyIndex}`
        )
        return true
    } catch (error) {
        console.error(`Failed to register hotkey ${hotkey}:`, error)
        return false
    }
}

export function unregisterHotkey(hotkey: string) {
    if (globalShortcut.isRegistered(hotkey)) {
        globalShortcut.unregister(hotkey)
        global.registeredHotkeys.delete(hotkey)
        console.log(`Unregistered hotkey: ${hotkey}`)
    }
}

export function unregisterAllHotkeysForDevice(deviceId: string) {
    for (const [hotkey, mapping] of global.registeredHotkeys.entries()) {
        if (mapping.deviceId === deviceId) {
            unregisterHotkey(hotkey)
        }
    }
}

export function unregisterAllHotkeys() {
    globalShortcut.unregisterAll()
    global.registeredHotkeys.clear()
    console.log('Unregistered all hotkeys')
}

export function isHotkeyConflict(
    hotkey: string,
    deviceId: string,
    keyIndex: number
): boolean {
    const mapping = global.registeredHotkeys.get(hotkey)
    if (!mapping) return false

    // If it's already mapped to this key, no problem
    if (mapping.deviceId === deviceId && mapping.keyIndex === keyIndex)
        return false

    return true
}

// Reload all hotkeys from the store at startup
export function loadHotkeysFromStore() {
    const deviceIds = store.get('deviceIds', []) as string[]
    for (const deviceId of deviceIds) {
        const keys = store.get(`device.${deviceId}.keys`, {}) as Record<
            string,
            any
        >
        for (const [keyIndexStr, keyConfig] of Object.entries(keys)) {
            const keyIndex = parseInt(keyIndexStr)
            if (keyConfig.hotkey) {
                const hotkey = keyConfig.hotkey
                registerHotkey(hotkey, deviceId, keyIndex)
            }
        }
    }
}
