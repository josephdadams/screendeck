import Store from 'electron-store'
import { defaultSettings } from './defaults'

export const store = new Store({ defaults: defaultSettings })
