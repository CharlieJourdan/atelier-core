import { describe, expect, it } from 'vitest'
import { isExternalHttpsUrl, isTrustedSender } from '../../src/main/electron/ipc-guard'

describe('isTrustedSender', () => {
  const mainFrame = { id: 'main' }
  const win = { webContents: { mainFrame } }

  it('accepts the main window top frame only', () => {
    expect(isTrustedSender({ sender: win.webContents, senderFrame: mainFrame }, win)).toBe(true)
  })

  it('refuses a sub-frame, a missing frame, another sender and a missing window', () => {
    expect(isTrustedSender({ sender: win.webContents, senderFrame: { id: 'iframe' } }, win)).toBe(false)
    expect(isTrustedSender({ sender: win.webContents, senderFrame: null }, win)).toBe(false)
    expect(isTrustedSender({ sender: win.webContents }, win)).toBe(false)
    expect(isTrustedSender({ sender: {}, senderFrame: mainFrame }, win)).toBe(false)
    expect(isTrustedSender({ sender: win.webContents, senderFrame: mainFrame }, null)).toBe(false)
  })
})

describe('isExternalHttpsUrl', () => {
  it('allows https only', () => {
    expect(isExternalHttpsUrl('https://example.com/a?b=1')).toBe(true)
    expect(isExternalHttpsUrl('http://example.com')).toBe(false)
    expect(isExternalHttpsUrl('file:///C:/Windows/System32/calc.exe')).toBe(false)
    expect(isExternalHttpsUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpsUrl('ms-msdt:/id')).toBe(false)
    expect(isExternalHttpsUrl('not a url')).toBe(false)
  })
})
