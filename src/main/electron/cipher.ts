import { safeStorage } from 'electron'
import type { Cipher } from '../secrets'

export const safeStorageCipher: Cipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(Buffer.from(cipher))
}
