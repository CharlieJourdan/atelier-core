// The providers `searchMedia` knows by default, in the order they are asked, and the keys they could use (for the docs, the
// vault list and the « which free keys are missing » answer). Keyless ones come first: they work out of the box.
import { elevenlabsMusic, elevenlabsSfx } from './providers/paid.ts'
import { freesound, jamendo } from './providers/audio-keyed.ts'
import { localBank } from './providers/local-bank.ts'
import { europeanaImages, europeanaSounds, europeanaVideo } from './providers/europeana.ts'
import { commonsMusic, commonsSfx, commonsVideo } from './providers/commons-media.ts'
import { internetArchiveMusic, internetArchiveSfx, internetArchiveVideo } from './providers/internet-archive-media.ts'
import { internetArchiveImages, metImages, nasaImages, wikimediaImages } from './providers/archives.ts'
import { naraImages, naraVideo } from './providers/nara.ts'
import { nasaSfx, nasaVideo } from './providers/nasa-media.ts'
import { smithsonianImages } from './providers/smithsonian.ts'
import { pexelsPhotos, pexelsVideos, pixabayPhotos, pixabayVideos } from './providers/stock.ts'
import { youtubeExcerpts } from './providers/ytdlp.ts'
import { openverseImages, openverseMusic, openverseSfx, wellcomeImages } from './providers/wellcome-openverse.ts'
import { clevelandImages, dvidsImages, dvidsVideo } from './providers/cleveland-dvids.ts'
import type { SourcingProvider } from './types.ts'

/** Free sources, no key. */
export const KEYLESS: readonly SourcingProvider[] = [
  wikimediaImages,
  wellcomeImages,
  clevelandImages,
  internetArchiveImages,
  nasaImages,
  metImages,
  commonsVideo,
  internetArchiveVideo,
  nasaVideo,
  commonsSfx,
  internetArchiveSfx,
  nasaSfx,
  commonsMusic,
  internetArchiveMusic
]

/** Free sources that need a free key (or have a public demo key for tests). */
export const KEYED: readonly SourcingProvider[] = [europeanaImages, europeanaVideo, europeanaSounds, smithsonianImages, naraImages, naraVideo, dvidsImages, dvidsVideo, pexelsPhotos, pexelsVideos, pixabayPhotos, pixabayVideos, freesound, jamendo]

/** Opt-in sources, asked only when named in `providers`: public web excerpts (yt-dlp; always human review) and Openverse (not yet verified live). */
export const WEB: readonly SourcingProvider[] = [youtubeExcerpts, openverseImages, openverseSfx, openverseMusic]

/** Paid slots: skipped unless `allowPaid`. */
export const PAID: readonly SourcingProvider[] = [elevenlabsSfx, elevenlabsMusic]

export const PROVIDERS: readonly SourcingProvider[] = [...KEYLESS, ...KEYED, ...WEB, ...PAID]

/** The default providers plus a local sound bank folder (`bank.json`), asked first for sounds. */
export const withLocalBank = (dir: string, base: readonly SourcingProvider[] = PROVIDERS): SourcingProvider[] => [localBank(dir), ...base]

/** The vault names of every free key the catalog could use, with where to get it. */
export const FREE_KEYS: ReadonlyArray<{ secret: string; site: string; unlocks: string }> = [
  { secret: 'EUROPEANA_API_KEY', site: 'https://pro.europeana.eu/pages/get-api', unlocks: 'Europeana (incl. Gallica/BnF, Bundesarchiv): images, film, sound' },
  { secret: 'SMITHSONIAN_API_KEY', site: 'https://api.data.gov/signup/', unlocks: 'Smithsonian Open Access (CC0 images)' },
  { secret: 'PIXABAY_API_KEY', site: 'https://pixabay.com/api/docs/', unlocks: 'Pixabay stock photos and videos' },
  { secret: 'FREESOUND_API_KEY', site: 'https://freesound.org/apiv2/apply/', unlocks: 'Freesound sound effects (CC0 / CC BY)' },
  { secret: 'PEXELS_API_KEY', site: 'https://www.pexels.com/api/ (new keys paused on 2026-11-02)', unlocks: 'Pexels stock photos and videos' },
  { secret: 'DVIDS_API_KEY', site: 'https://api.dvidshub.net/ (sign up for an access key)', unlocks: 'DVIDS: US Department of Defense photographs and video (public domain)' },
  { secret: 'NARA_API_KEY', site: 'email Catalog_API@nara.gov', unlocks: 'US National Archives catalogue (photos, film)' },
  { secret: 'JAMENDO_CLIENT_ID', site: 'https://devportal.jamendo.com', unlocks: 'Jamendo CC music (human review, non-commercial API)' }
]
