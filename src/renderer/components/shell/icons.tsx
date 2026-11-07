// lucide icon per section (names come from src/shared/sections.ts).
import {
  CalendarDays,
  Clapperboard,
  House,
  Inbox,
  MessagesSquare,
  Monitor,
  Settings,
  Sparkles,
  TvMinimalPlay,
  UsersRound,
  Wallet,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import { SECTION_ICONS, type SectionId } from '../../../shared/sections'

const BY_NAME: Record<(typeof SECTION_ICONS)[SectionId], LucideIcon> = {
  house: House,
  'calendar-days': CalendarDays,
  clapperboard: Clapperboard,
  'users-round': UsersRound,
  'messages-square': MessagesSquare,
  sparkles: Sparkles,
  'tv-minimal-play': TvMinimalPlay,
  wallet: Wallet,
  monitor: Monitor,
  inbox: Inbox,
  wrench: Wrench,
  settings: Settings
}

export function SectionIcon({ section, className }: { section: SectionId; className?: string }) {
  const Icon = BY_NAME[SECTION_ICONS[section]]
  return <Icon className={className ?? 'size-[18px]'} strokeWidth={1.7} aria-hidden />
}
