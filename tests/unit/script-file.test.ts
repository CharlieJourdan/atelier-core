// « J'ai mon script » (agents-production): the text of a dropped .txt or .docx file, read by the main process with no
// library (a .docx is a zip whose word/document.xml holds the paragraphs).
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { scriptFromFile } from '../../src/main/production/recipes/script-file'

/** A minimal zip with the given files (deflated), as Word writes them. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8')
    const data = deflateRawSync(raw)
    const n = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, data)
    centrals.push(central, n)
    offset += 30 + n.length + data.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

const file = (name: string, bytes: Buffer) => ({ name, base64: bytes.toString('base64') })

describe('a script file becomes the script text', () => {
  it('a .docx: its paragraphs in order, runs joined, tabs and entities kept', () => {
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      '<w:p><w:r><w:t>Aujourd’hui, on purge </w:t></w:r><w:r><w:t xml:space="preserve">un radiateur.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Étape 1 :</w:t><w:tab/><w:t>couper &amp; attendre.</w:t></w:r></w:p>' +
      '<w:p></w:p><w:p><w:r><w:t>Fin.</w:t></w:r></w:p></w:body></w:document>'
    const r = scriptFromFile(file('marcel.docx', zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': xml })))
    expect(r.text).toBe('Aujourd’hui, on purge un radiateur.\nÉtape 1 :\tcouper & attendre.\n\nFin.')
    expect(r.words).toBe(12)
  })

  it('a .txt in UTF-8 or UTF-16; anything else, an empty or a broken file is refused in French', () => {
    expect(scriptFromFile(file('s.txt', Buffer.from('Bonjour à tous.\r\nOn commence.', 'utf8'))).text).toBe('Bonjour à tous.\nOn commence.')
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Salut.', 'utf16le')])
    expect(scriptFromFile(file('s.txt', utf16)).text).toBe('Salut.')
    expect(() => scriptFromFile(file('s.pdf', Buffer.from('x')))).toThrow(/\.txt ou \.docx/)
    expect(() => scriptFromFile(file('s.txt', Buffer.from('  \n ')))).toThrow(/pas de texte/)
    expect(() => scriptFromFile(file('s.docx', Buffer.from('pas un zip')))).toThrow(/illisible/)
    expect(() => scriptFromFile(file('s.docx', zip({ 'autre.xml': '<x/>' })))).toThrow(/illisible/)
  })
})
