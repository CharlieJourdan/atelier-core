// Ordered list of migrations. Append only; never edit a migration that has shipped.
import type { DatabaseSync } from 'node:sqlite'
import * as m001 from './001_initial'
import * as m002 from './002_seed_defaults'
import * as m003 from './003_real_prices'
import * as m004 from './004_route_effort'
import * as m005 from './005_agents_runner'
import * as m006 from './006_render_jobs'
import * as m007 from './007_revision_resume'
import * as m008 from './008_engine_jobs'
import * as m009 from './009_group_chat'
import * as m010 from './010_cloud_spend'
import * as m011 from './011_example'
import * as m012 from './012_production_runs'
import * as m013 from './013_analysis'
import * as m014 from './014_money'
import * as m015 from './015_tools'
import * as m016 from './016_team'
import * as m017 from './017_home'
import * as m018 from './018_ideas'
import * as m019 from './019_orchestra'
import * as m020 from './020_run_inputs'
import * as m021 from './021_eyes'
import * as m022 from './022_agent_context'
import * as m023 from './023_google'
import * as m024 from './024_bricks'
import * as m025 from './025_recipes'
import * as m026 from './026_channel_goals'
import * as m027 from './027_plan'
import * as m028 from './028_allow_rules'
import * as m029 from './029_production_model'
import * as m030 from './030_channel_voices'
import * as m031 from './031_pipeline_threads'
import * as m032 from './032_channel_presenters'
import * as m033 from './033_channel_sponsors'
import * as m034 from './034_style_studies'
import * as m035 from './035_real_runs'
import * as m036 from './036_agent_look'
import * as m037 from './037_team_production'
import * as m038 from './038_run_notes'
import * as m039 from './039_claude_usage'
import * as m040 from './040_creation_sessions'
import * as m041 from './041_video_orders'

export interface Migration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
  /** Runs with foreign keys off (a table rebuild that must not fire ON DELETE actions); keys are checked before commit. */
  foreignKeysOff?: boolean
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: m001.name, up: (db) => db.exec(m001.sql) },
  { version: 2, name: m002.name, up: m002.up },
  { version: 3, name: m003.name, up: m003.up },
  { version: 4, name: m004.name, up: m004.up },
  { version: 5, name: m005.name, up: m005.up },
  { version: 6, name: m006.name, up: m006.up },
  { version: 7, name: m007.name, up: m007.up },
  { version: 8, name: m008.name, up: m008.up },
  { version: 9, name: m009.name, up: m009.up, foreignKeysOff: m009.foreignKeysOff },
  { version: 10, name: m010.name, up: m010.up },
  { version: 11, name: m011.name, up: m011.up },
  { version: 12, name: m012.name, up: m012.up },
  { version: 13, name: m013.name, up: m013.up },
  { version: 14, name: m014.name, up: m014.up },
  { version: 15, name: m015.name, up: m015.up },
  { version: 16, name: m016.name, up: m016.up },
  { version: 17, name: m017.name, up: m017.up },
  { version: 18, name: m018.name, up: m018.up },
  { version: 19, name: m019.name, up: m019.up },
  { version: 20, name: m020.name, up: m020.up },
  { version: 21, name: m021.name, up: m021.up },
  { version: 22, name: m022.name, up: m022.up },
  { version: 23, name: m023.name, up: m023.up },
  { version: 24, name: m024.name, up: m024.up },
  { version: 25, name: m025.name, up: m025.up },
  { version: 26, name: m026.name, up: m026.up },
  { version: 27, name: m027.name, up: m027.up },
  { version: 28, name: m028.name, up: m028.up },
  { version: 29, name: m029.name, up: m029.up },
  { version: 30, name: m030.name, up: m030.up },
  { version: 31, name: m031.name, up: m031.up },
  { version: 32, name: m032.name, up: m032.up },
  { version: 33, name: m033.name, up: m033.up },
  { version: 34, name: m034.name, up: m034.up },
  { version: 35, name: m035.name, up: m035.up },
  { version: 36, name: m036.name, up: m036.up },
  { version: 37, name: m037.name, up: m037.up, foreignKeysOff: m037.foreignKeysOff },
  { version: 38, name: m038.name, up: m038.up },
  { version: 39, name: m039.name, up: m039.up },
  { version: 40, name: m040.name, up: m040.up },
  { version: 41, name: m041.name, up: m041.up }
]
