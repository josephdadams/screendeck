// src/defaults.ts

import os from 'os'

export const defaultSettings = {
    companionIP: '127.0.0.1',
    companionPort: 16622,
    showOnStartup: true,
    deviceIds: [],
    installationName: `ScreenDeck ${os.hostname()}`,
    mdnsEnabled: true,
    restEnabled: true,
    restPort: 9999,
}

export type SettingsType = typeof defaultSettings
