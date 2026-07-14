import { globalShortcut } from 'electron'
import { store } from './store'
import { toggleAllDeviceWindows, toggleDeviceWindow } from './device'

// A registered global hotkey is bound to one of three kinds of action:
// - 'key': sends a Companion key press/release, exactly like clicking the key
// - 'toggleAll': shows/hides every device window
// - 'toggleDevice': shows/hides one specific device window
export type HotkeyBinding =
    | { kind: 'key'; deviceId: string; keyIndex: number; imageBase64: string }
    | { kind: 'toggleAll' }
    | { kind: 'toggleDevice'; deviceId: string }

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
            kind: 'key',
            deviceId,
            keyIndex,
            imageBase64,
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

export function registerToggleAllHotkey(hotkey: string): boolean {
    if (globalShortcut.isRegistered(hotkey)) {
        console.warn(`Hotkey ${hotkey} is already in use`)
        return false
    }

    try {
        globalShortcut.register(hotkey, () => {
            toggleAllDeviceWindows()
        })

        global.registeredHotkeys.set(hotkey, { kind: 'toggleAll' })
        console.log(`Registered hotkey: ${hotkey} for Show/Hide All`)
        return true
    } catch (error) {
        console.error(`Failed to register hotkey ${hotkey}:`, error)
        return false
    }
}

export function registerToggleDeviceHotkey(
    hotkey: string,
    deviceId: string
): boolean {
    if (globalShortcut.isRegistered(hotkey)) {
        console.warn(`Hotkey ${hotkey} is already in use`)
        return false
    }

    try {
        globalShortcut.register(hotkey, () => {
            toggleDeviceWindow(deviceId)
        })

        global.registeredHotkeys.set(hotkey, {
            kind: 'toggleDevice',
            deviceId,
        })
        console.log(`Registered hotkey: ${hotkey} for Show/Hide ${deviceId}`)
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
    for (const [hotkey, binding] of global.registeredHotkeys.entries()) {
        if (
            (binding.kind === 'key' || binding.kind === 'toggleDevice') &&
            binding.deviceId === deviceId
        ) {
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
    const binding = global.registeredHotkeys.get(hotkey)
    if (!binding) return false

    // If it's already mapped to this same key, no problem
    if (
        binding.kind === 'key' &&
        binding.deviceId === deviceId &&
        binding.keyIndex === keyIndex
    )
        return false

    return true
}

// Reload all hotkeys from the store at startup
export function loadHotkeysFromStore() {
    const deviceIds = store.get('deviceIds', []) as string[]

    const toggleAllHotkey = store.get('appHotkeys.toggleAll') as
        | string
        | undefined
    if (toggleAllHotkey) {
        registerToggleAllHotkey(toggleAllHotkey)
    }

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

        const toggleDeviceHotkey = store.get(
            `device.${deviceId}.toggleHotkey`
        ) as string | undefined
        if (toggleDeviceHotkey) {
            registerToggleDeviceHotkey(toggleDeviceHotkey, deviceId)
        }
    }
}
