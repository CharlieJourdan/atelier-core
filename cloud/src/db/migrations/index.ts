// Atelier Cloud migrations (its own sequence, independent of the app's). Append only; never edit one that has shipped.
import type { DatabaseSync } from 'node:sqlite'
import * as m001 from './001_initial.ts'
import * as m002 from './002_default_prices.ts'
import * as m003 from './003_provider_ref.ts'
import * as m004 from './004_team_machines.ts'
import * as m005 from './005_billing.ts'
import * as m006 from './006_blueprints.ts'
import * as m007 from './007_voice_clone_price.ts'
import * as m008 from './008_machine_relay.ts'
import * as m009 from './009_provider_quota.ts'
import * as m010 from './010_video_kits.ts'
import * as m011 from './011_email_accounts.ts'
import * as m012 from './012_app_releases.ts'
import * as m013 from './013_team_invites.ts'
import * as m014 from './014_account_status.ts'
import * as m015 from './015_team_backups.ts'
import * as m016 from './016_provider_alerts.ts'
import * as m017 from './017_finance.ts'
import * as m018 from './018_credit_carry.ts'
import * as m019 from './019_test_teams.ts'
import * as m020 from './020_free_quotes.ts'

export interface CloudMigration {
  version: number
  name: string
  up: (db: DatabaseSync) => void
}

export const CLOUD_MIGRATIONS: readonly CloudMigration[] = [
  { version: 1, name: m001.name, up: (db) => db.exec(m001.sql) },
  { version: 2, name: m002.name, up: m002.up },
  { version: 3, name: m003.name, up: (db) => db.exec(m003.sql) },
  { version: 4, name: m004.name, up: (db) => db.exec(m004.sql) },
  { version: 5, name: m005.name, up: (db) => db.exec(m005.sql) },
  { version: 6, name: m006.name, up: (db) => db.exec(m006.sql) },
  { version: 7, name: m007.name, up: m007.up },
  { version: 8, name: m008.name, up: (db) => db.exec(m008.sql) },
  { version: 9, name: m009.name, up: (db) => db.exec(m009.sql) },
  { version: 10, name: m010.name, up: (db) => db.exec(m010.sql) },
  { version: 11, name: m011.name, up: (db) => db.exec(m011.sql) },
  { version: 12, name: m012.name, up: (db) => db.exec(m012.sql) },
  { version: 13, name: m013.name, up: (db) => db.exec(m013.sql) },
  { version: 14, name: m014.name, up: (db) => db.exec(m014.sql) },
  { version: 15, name: m015.name, up: (db) => db.exec(m015.sql) },
  { version: 16, name: m016.name, up: (db) => db.exec(m016.sql) },
  { version: 17, name: m017.name, up: (db) => db.exec(m017.sql) },
  { version: 18, name: m018.name, up: (db) => db.exec(m018.sql) },
  { version: 19, name: m019.name, up: (db) => db.exec(m019.sql) },
  { version: 20, name: m020.name, up: m020.up }
]
