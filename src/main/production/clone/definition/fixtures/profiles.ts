// The five acceptance channels of chantier B as analysis profiles (tests and proofs only). Facts come from the research
// docs where a doc measured them (`sources`, docs path:line); every other value is a FIXTURE value, said so. They stand in
// for chantier A's real analyses until A saves them in the analyses folder.
import type { ChannelProfile, ShotTemplate } from './build'

const P = (lengthS: number, angle: number, layout: ShotTemplate['layout'] = 'full', shows = 'presenter to camera'): ShotTemplate => ({ kind: 'presenter', origin: 'presenter', lengthS, layout, angle, shows })
const S = (kind: ShotTemplate['kind'], origin: ShotTemplate['origin'], lengthS: number, shows: string, extra: Partial<ShotTemplate> = {}): ShotTemplate => ({ kind, origin, lengthS, shows, ...extra })

/** Finary: a REAL filmed presenter in a studio (several angles) + motion design that illustrates everything. */
export const FINARY: ChannelProfile = {
  id: 'finary', url: 'https://www.youtube.com/@Finary', language: 'en', durationS: 1500, videos: 5,
  sources: {
    presenter: 'docs/research/creation-conversationnelle-2026-11.md:32-33 (real person, real studio, several angles, 57 %)',
    shares: 'creation-conversationnelle:33 (presenter 57, motion 18, charts 8, filmed people 7, screen 3, generated 3)',
    pace: 'creation-conversationnelle:30-31 (247 wpm, median shot 6.3 s, hook 6 shots in 19 s)',
    identity: 'fixture (not measured in docs)', palette: 'fixture (docs say « Finary red set », no hex)', sound: 'fixture'
  },
  titles: ['How to protect your money from your bank', 'Never work again', 'The most powerful man no one is talking about', 'This tax lesson should be mandatory'],
  parts: [
    { part: 'hook', share: 0.013, cycle: [P(3.2, 0), S('chart', 'motion', 3, 'animated bar chart'), P(3.2, 1), S('motion-graphic', 'motion', 3, 'glass panel with a figure'), S('stock-footage', 'filmed', 3.4, 'people at a bank counter'), P(3.2, 2)] },
    { part: 'body', share: 0.93, cycle: [P(8.5, 0), S('motion-graphic', 'motion', 6, 'glass panel numbers'), P(8, 1), S('chart', 'motion', 6.3, 'line chart of savings'), P(8.5, 2), S('stock-footage', 'filmed', 5, 'people filmed in the street'), P(8, 0, 'half-left'), S('screen-capture', 'screen', 2.5, 'app screen'), S('generated', 'generated', 2.5, 'generated illustration'), S('motion-graphic', 'motion', 6, 'numbered chapter card'), P(7, 1)] },
    { part: 'end', share: 0.057, cycle: [P(6, 0), S('title-card', 'motion', 5, 'end card')] }
  ],
  presenter: {
    kind: 'real',
    identity: { age: '30-40', gender: 'man', face: 'clean-shaven', hair: 'short dark', wardrobe: 'dark crew-neck sweater', setting: 'bright modern studio, plants, shelves', lighting: 'soft key light' },
    angles: [{ framing: 'medium', description: 'facing camera' }, { framing: 'close', description: 'three-quarter close' }, { framing: 'wide', description: 'wide studio shot' }],
    entries: ['cold open on camera'], exits: ['cut to end card']
  },
  voice: { kind: 'real', timbre: 'young male, bright', wpm: 247, pausesPerMinute: 4, meanPauseS: 0.3, energy: 'high' },
  motion: { types: { chart: 'chart', 'motion-graphic': 'card', 'title-card': 'card' }, durationS: 6, easing: 'ease-out', landingOffsetS: -0.1, texture: 'glass panels', palette: ['#E4002B', '#111111', '#FFFFFF'], fonts: ['Inter'] },
  editing: { cutTypes: { hard: 200, zoom: 20 }, transitions: ['hard cut'], colour: 'clean, high contrast' },
  sound: { music: true, genre: 'light electronic', levelDb: -24, changes: 'per-part', sfx: [{ kind: 'whoosh', on: 'card entry', perMinute: 2 }], lufs: -14 },
  script: { structure: ['hook', 'promise', 'story 1', 'story 2', 'story 3', 'payoff', 'cta'], hookPattern: 'shocking figure + question', promise: 'you will understand what your bank does with your money', payoff: 'the concrete move', chapters: true, cta: 'download the app', sentenceWords: 11, tone: 'direct, pedagogical', devices: ['numbered stories', 'rhetorical question'] },
  packaging: { titlePattern: 'bold claim about money', thumbnailPattern: 'face + one big word' }
}

/** The Japanese Method: a real middle-aged man filmed hand-held, in his home, acting in the pictures; full frame only. */
export const JAPANESE: ChannelProfile = {
  id: 'japanese-method', url: 'https://www.youtube.com/@TheJapaneseMethod0', language: 'en', durationS: 1560, videos: 4,
  sources: {
    presenter: 'docs/research/style-japanese-method-2026-11.md:37-50 (real, hand-held selfie, red polo, home, full frame only, acting 21-42 %)',
    pace: 'style-japanese-method:35-36 (192 wpm, a cut every 2.7 s, hook 22-26 shots/min)',
    sound: 'style-japanese-method:63 (soft piano bed, no SFX)', script: 'style-japanese-method:67-75',
    angles: 'fixture (4 framings: selfie, kitchen, entrance, close; docs do not count them)', palette: 'fixture (offer card yellow only)'
  },
  titles: ['7 Things Japanese Homes Never Have', "I'm 52 and Japanese: what I stopped buying", '5 Habits That Keep Japanese Homes Clean', '6 Things Japanese People Never Do at Home'],
  parts: [
    { part: 'hook', share: 0.02, cycle: [P(4.5, 0, 'full', 'hand-held selfie'), S('other', 'filmed', 2.4, 'his hands at the sink'), S('other', 'filmed', 2.4, 'shoji window'), P(2.4, 1, 'full', 'him walking in the entrance')] },
    { part: 'body', share: 0.86, cycle: [S('other', 'filmed', 2.7, 'object close-up'), P(2.7, 1, 'full', 'him acting in the kitchen'), S('other', 'filmed', 2.7, 'a room of the house'), S('other', 'filmed', 2.7, 'another person in the street'), P(2.7, 2, 'full', 'him at the entrance'), S('other', 'filmed', 2.7, 'a shop shelf'), P(2.7, 3, 'full', 'close on his hands and face'), S('other', 'filmed', 2.7, 'a detail of the home')] },
    { part: 'promo', share: 0.012, cycle: [S('screen-capture', 'screen', 6, 'sales page'), S('title-card', 'motion', 6, 'SCAN THE CODE card', { text: 'SCAN THE CODE' })] },
    { part: 'end', share: 0.108, cycle: [S('other', 'filmed', 2.7, 'calm shot of the home'), P(3, 0, 'full', 'selfie goodbye')] }
  ],
  presenter: {
    kind: 'real',
    identity: { age: 'middle-aged (about 50)', gender: 'man', face: 'smiling, short', hair: 'short black', wardrobe: 'red polo shirt', setting: 'Japanese home: kitchen and entrance, wood cabinets, shoji windows', lighting: 'daylight from the windows' },
    angles: [{ framing: 'close', description: 'hand-held selfie at arm\'s length' }, { framing: 'medium', description: 'acting in the kitchen' }, { framing: 'wide', description: 'at the entrance' }, { framing: 'close', description: 'hands and face close' }],
    entries: ['cold open selfie'], exits: ['selfie goodbye']
  },
  voice: { kind: 'real', timbre: 'middle-aged male, calm storyteller, neutral American English', wpm: 192, pausesPerMinute: 8, meanPauseS: 0.5, energy: 'medium' },
  motion: { types: { 'title-card': 'card' }, durationS: 6, easing: 'linear', landingOffsetS: 0, texture: 'blurred page behind', palette: ['#FFD400', '#FFFFFF'], fonts: ['bold sans capitals'] },
  editing: { cutTypes: { hard: 560 }, transitions: ['hard cut'], colour: 'natural daylight, phone camera' },
  sound: { music: true, genre: 'soft piano', levelDb: -22, changes: 'none', sfx: [], lufs: -16 },
  script: { structure: ['first-person cold open', 'promise', 'numbered items', 'offer', 'items', 'reflective close'], hookPattern: 'first-person personal story', promise: 'N things Japanese homes do', payoff: 'a reflective line', chapters: false, cta: 'tell me in the comments', sentenceWords: 10, tone: 'calm, personal', devices: ['numbered list', 'personal memory'] },
  packaging: { titlePattern: 'N Things ... That Japanese Homes ...', thumbnailPattern: 'his face + home object' }
}

const POV_DRAWN: ShotTemplate[] = [S('illustration', 'drawn', 2.8, 'hero in a scene'), S('chart', 'drawn', 3, 'data card with red strike'), S('illustration', 'drawn', 2.6, 'face close-up'), S('motion-graphic', 'drawn', 2.8, 'phone UI card'), S('illustration', 'drawn', 2.8, 'side character'), S('chart', 'drawn', 3, 'ring countdown'), S('illustration', 'drawn', 2.6, 'hero walking'), S('motion-graphic', 'drawn', 2.8, 'icon grid')]

/** Le Monde en POV: no presenter, 100 % drawn 2D vector motion design, a 3D render about once per 80 s. */
export const MONDE_POV: ChannelProfile = {
  id: 'monde-pov', url: 'https://www.youtube.com/@lemondedécrypté', language: 'fr', durationS: 840, videos: 6,
  sources: {
    origins: 'docs/research/style-monde-pov-2026-11.md:35-45 (no presenter, drawn 2D, one 3D render per ~80 s)',
    pace: 'style-monde-pov:61-68,143 (215 wpm, median 2.3-3.4 s, hook median 1.8-2.8 s)',
    sound: 'style-monde-pov:145-151 (lo-fi bed ~15 dB under, SFX ~13/min on graphics, -15 LUFS)',
    palette: 'style-monde-pov:128-133 (#0E1230 navy, #E8552F hero; gold fixture)', script: 'style-monde-pov:50-56,154-157'
  },
  titles: ['Félicitations, tu viens de gagner 1 milliard', 'Tu as 24 h pour dépenser 1 000 milliards', 'Tu deviens président pour une journée', 'Tu hérites d\'une île'],
  parts: [
    { part: 'hook', share: 0.03, cycle: [S('illustration', 'drawn', 2.3, 'hero stick figure, face close-up'), S('chart', 'drawn', 2.3, 'navy data card, gold count-up'), S('title-card', 'drawn', 2.3, 'gold title over skyline')] },
    { part: 'body', share: 0.94, cycle: [...POV_DRAWN, ...POV_DRAWN, S('generated', '3d', 3, 'low-poly 3D render')] },
    { part: 'end', share: 0.03, cycle: [S('title-card', 'drawn', 4, 'Et toi, que ferais-tu ? + subscribe pill', { text: 'Et toi, que ferais-tu ?' })] }
  ],
  presenter: { kind: 'none', identity: null, angles: [], entries: [], exits: [] },
  voice: { kind: 'synthetic', timbre: 'young male, energetic, dry close-mic', wpm: 215, pausesPerMinute: 2, meanPauseS: 0.3, energy: 'high' },
  motion: { types: { illustration: 'other', chart: 'chart', 'motion-graphic': 'card', 'title-card': 'kinetic-type' }, durationS: 2.8, easing: 'ease-out back', landingOffsetS: -0.05, texture: 'flat vector, blurred plates', palette: ['#0E1230', '#E8552F', '#F2B632'], fonts: ['rounded geometric sans ExtraBold'] },
  editing: { cutTypes: { hard: 280, dissolve: 8, wipe: 8 }, transitions: ['hard cut', 'dip', 'blur smear'], colour: 'dusk violet to orange' },
  sound: { music: true, genre: 'electronic lo-fi 90-100 BPM', levelDb: -15, changes: 'none', sfx: [{ kind: 'pop', on: 'graphic event', perMinute: 13 }], lufs: -15 },
  script: { structure: ['congratulation hook', 'physical comparison', 'catch', 'timed story', 'reality checks', 'ironic ending'], hookPattern: 'Félicitations, tu viens de…', promise: 'what would really happen', payoff: 'ironic or dark ending', chapters: false, cta: 'Et toi, que ferais-tu ?', sentenceWords: 11, tone: 'second person, ironic', devices: ['side characters with first names', 'reality-check card every minute'] },
  packaging: { titlePattern: 'second-person challenge in capitals', thumbnailPattern: 'hero figure + huge number' }
}

/** Marcel (Charlie's own channel): his presenter full / half / inset per part, phone-look generated B-roll, no music. */
export const MARCEL: ChannelProfile = {
  id: 'marcel', url: 'https://www.youtube.com/@MarcelArtisan', language: 'fr', durationS: 794, videos: 2,
  sources: {
    presenter: 'docs/research/reference-video-2-2026-11.md:27,43-45 (man in his sixties, grey hair, navy overalls, boiler room, chest-up)',
    layouts: 'docs/research/avatar-layouts (full 2.3 %, split 17.2 %, inset 5.0 %; hook full 36 %)',
    pace: 'reference-video-2:25-26 (191 wpm, mean shot 3.7 s, median 3.3 s)', origins: 'reference-video-2:28-30 (B-roll 64 %, cards 3.6 %)',
    palette: 'docs/research/marcel-complet-2026-11.md:15 (#11192B, #223C61, #E49D56)', sound: 'reference-video-2:18 (no music)'
  },
  titles: ['Faites ces 5 choses avant les premières gelées', 'Cette vieille astuce de artisan'],
  parts: [
    { part: 'hook', share: 0.064, cycle: [P(4.2, 0, 'full', 'Marcel to camera, boiler room'), S('generated', 'generated', 3.4, 'frost on a window, phone look'), S('generated', 'generated', 3.4, 'gloved hand on a valve')] },
    { part: 'promo', share: 0.02, cycle: [S('title-card', 'motion', 15.4, 'offer card: book, URL, QR code')] },
    { part: 'body', share: 0.86, cycle: [S('generated', 'generated', 3.4, 'water meter close-up'), S('generated', 'generated', 4.3, 'boiler front panel', { layout: 'half-left', angle: 0 }), S('generated', 'generated', 3.1, 'copper pipes'), S('generated', 'generated', 3.3, 'insulation sleeve'), S('generated', 'generated', 4.3, 'radiator purge', { layout: 'half-left', angle: 0 }), S('generated', 'generated', 4.9, 'thermostat', { layout: 'inset', angle: 0 }), S('generated', 'generated', 3.2, 'frosty garden tap'), S('generated', 'generated', 3.4, 'cellar pipes')] },
    { part: 'end', share: 0.056, cycle: [S('generated', 'generated', 4.3, 'warm living room', { layout: 'half-left', angle: 0 }), S('generated', 'generated', 4.9, 'boiler running', { layout: 'inset', angle: 0 }), S('title-card', 'motion', 13.4, 'end card')] }
  ],
  presenter: {
    kind: 'real',
    identity: { age: 'sixties', gender: 'man', face: 'glasses pushed up', hair: 'grey', wardrobe: 'navy work overalls, pencil in the chest pocket, grey T-shirt', setting: 'boiler room: white boiler, hot-water tank, copper pipes', lighting: 'overcast daylight' },
    angles: [{ framing: 'medium', description: 'chest-up, same framing every time' }],
    entries: ['cold open on camera'], exits: ['end card']
  },
  voice: { kind: 'real', timbre: 'older male, warm, regional French', wpm: 191, pausesPerMinute: 6, meanPauseS: 0.4, energy: 'medium' },
  motion: { types: { 'title-card': 'card' }, durationS: 14, easing: 'ease-in-out', landingOffsetS: 0, texture: 'night glow', palette: ['#11192B', '#223C61', '#E49D56'], fonts: ['serif title'] },
  editing: { cutTypes: { hard: 216 }, transitions: ['hard cut'], colour: 'phone camera, overcast winter daylight' },
  sound: { music: false, genre: '', levelDb: null, changes: 'none', sfx: [], lufs: -16 },
  script: { structure: ['second-person story cold open', 'promise of 5 gestures', 'presenter introduces himself', 'offer card', 'five gestures with why, order, trap', 'comments CTA'], hookPattern: 'second-person story on a date', promise: '5 gestures before the frost', payoff: 'the house stays warm', chapters: false, cta: 'dites-moi en commentaire', sentenceWords: 12, tone: 'craftsman, plain, reassuring', devices: ['numbered gestures', 'the trap to avoid'] },
  packaging: { titlePattern: 'imperative + number + season', thumbnailPattern: 'Marcel + frosty object' }
}

/** Yarnhub: game-engine 3D renders on ~93 % of the screen; animated maps and cards for the rest. */
export const YARNHUB: ChannelProfile = {
  id: 'yarnhub', url: 'https://www.youtube.com/@Yarnhub', language: 'en', durationS: 1120, videos: 3,
  sources: {
    origins: 'docs/research/creation-conversationnelle-2026-11.md:52 (3D on 88-97 % of shots, 93 % of the screen)',
    pace: 'creation-conversationnelle:51 (165 wpm, median shot 2.5 s)', palette: 'fixture', sound: 'fixture', voice: 'fixture'
  },
  titles: ['When the US Hit Tokyo After Pearl Harbor', 'Wake Island', 'When Ha-Go Tanks Ambushed M3 Stuarts'],
  parts: [
    { part: 'hook', share: 0.03, cycle: [S('generated', '3d', 2.2, '3D bombers over the sea'), S('generated', '3d', 2.2, '3D pilot in the cockpit'), S('map', 'motion', 2.5, 'animated map of the Pacific')] },
    { part: 'body', share: 0.94, cycle: [S('generated', '3d', 2.5, '3D tanks in the jungle'), S('generated', '3d', 2.5, '3D soldiers'), S('generated', '3d', 2.5, '3D explosion'), S('generated', '3d', 2.5, '3D aircraft carrier'), S('generated', '3d', 2.5, '3D close-up of a gunner'), S('generated', '3d', 2.5, '3D island'), S('map', 'motion', 2.5, 'animated front-line map'), S('generated', '3d', 2.5, '3D formation'), S('generated', '3d', 2.5, '3D ruins'), S('generated', '3d', 2.5, '3D night attack'), S('generated', '3d', 2.5, '3D officers'), S('generated', '3d', 2.5, '3D dogfight'), S('generated', '3d', 2.5, '3D beach'), S('generated', '3d', 2.5, '3D shells')] },
    { part: 'end', share: 0.03, cycle: [S('generated', '3d', 3, '3D aftermath'), S('title-card', 'motion', 4, 'end card')] }
  ],
  presenter: { kind: 'none', identity: null, angles: [], entries: [], exits: [] },
  voice: { kind: 'real', timbre: 'male narrator, documentary', wpm: 165, pausesPerMinute: 6, meanPauseS: 0.5, energy: 'medium' },
  motion: { types: { map: 'map', 'title-card': 'card' }, durationS: 2.5, easing: 'ease-in-out', landingOffsetS: 0, texture: 'military map paper', palette: ['#3B4A2F', '#C9B27C', '#8B1E1E'], fonts: ['stencil sans'] },
  editing: { cutTypes: { hard: 430, dissolve: 20 }, transitions: ['hard cut', 'dissolve'], colour: 'game-engine, desaturated war tones' },
  sound: { music: true, genre: 'orchestral war score', levelDb: -18, changes: 'per-part', sfx: [{ kind: 'explosion', on: 'battle shots', perMinute: 6 }], lufs: -14 },
  script: { structure: ['cold open in battle', 'context', 'the engagement', 'turning point', 'aftermath'], hookPattern: 'in medias res battle', promise: 'how this battle really went', payoff: 'the outcome and its cost', chapters: false, cta: 'play our game', sentenceWords: 14, tone: 'dramatic documentary', devices: ['animated maps', 'named units'] },
  packaging: { titlePattern: 'When X Hit Y', thumbnailPattern: '3D vehicles + explosion' }
}

export const PROFILES = { finary: FINARY, japanese: JAPANESE, mondePov: MONDE_POV, marcel: MARCEL, yarnhub: YARNHUB } as const
