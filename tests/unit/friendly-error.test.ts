// Every error the user can meet is a calm French sentence with a next step (app-ux-robustesse-2).
import { describe, expect, it } from 'vitest'
import { friendlyMessage } from '../../src/shared/friendly-error'

const noTech = (s: string): void => {
  expect(s).not.toMatch(/SQLITE|ENOSPC|ECONN|ENOENT|EACCES|ERR_|\bat .*:\d+|Error:|undefined|\[object/)
  expect(s.length).toBeGreaterThan(20)
}

describe('friendlyMessage', () => {
  const cases: [string, string, RegExp][] = [
    ['ENOSPC: no space left on device, write', 'ENOSPC', /disque est plein/],
    ['database or disk is full', 'ERR_SQLITE_ERROR', /disque est plein/],
    ['database is locked', 'ERR_SQLITE_ERROR', /utilisées par autre chose/],
    ['database disk image is malformed', 'SQLITE_CORRUPT', /abîmé/],
    ['attempt to write a readonly database SQLITE_READONLY', 'ERR_SQLITE_ERROR', /pas écrire/],
    ['connect ECONNREFUSED 127.0.0.1:8787', 'ECONNREFUSED', /ne joint pas Internet/],
    ['fetch failed', 'ERROR', /ne joint pas Internet/],
    ['getaddrinfo ENOTFOUND cloud.example', 'ENOTFOUND', /ne joint pas Internet/],
    ['The operation was aborted due to timeout', 'ERROR', /trop de temps/],
    ['EACCES: permission denied, open C:/x', 'EACCES', /pas le droit/],
    ["ENOENT: no such file or directory, open 'C:/x'", 'ENOENT', /introuvable/],
    ['Request failed with status 401 unauthorized', 'ERROR', /connexion n’est plus valable/],
    ['HTTP 503 Service Unavailable', 'ERROR', /souci de son côté/],
    ['Unexpected token < in JSON at position 0', 'ERROR', /réponse qu’il ne comprend pas/],
    ['Error: boom\n    at foo (C:/app/x.js:10:5)\n    at bar (node:internal/x:1:1)', 'ERROR', /Quelque chose s’est mal passé/],
    ['', 'ERROR', /Quelque chose s’est mal passé/],
    ['Unknown agent: ghost', 'ERROR', /n’a pas pu aboutir/],
    ['The key is empty', 'ERROR', /n’a pas pu aboutir/]
  ]
  for (const [message, code, expected] of cases) {
    it(`${code}: ${message.split('\n')[0]!.slice(0, 40)}`, () => {
      const out = friendlyMessage(message, code)
      expect(out).toMatch(expected)
      noTech(out)
    })
  }
  it('keeps the app’s own French sentences, even those that mention a file or a connection', () => {
    expect(friendlyMessage('Colle un lien de vidéo YouTube public.')).toBe('Colle un lien de vidéo YouTube public.')
    expect(friendlyMessage('Le fichier est introuvable dans le dossier du projet.')).toBe('Le fichier est introuvable dans le dossier du projet.')
    expect(friendlyMessage('Atelier Cloud ne répond pas : vérifie ta connexion.')).toContain('ne répond pas')
  })
})
