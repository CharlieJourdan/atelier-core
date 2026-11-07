// The FeatureContext of the whole app: Atelier Cloud's catalogue (`cloud.catalog`, null = not connected or unreachable,
// so every Cloud function stays demo), reloaded whenever main reports a 'cloud' change.
import type { ReactNode } from 'react'
import { NO_FEATURES } from '../../shared/features'
import { FeaturesProvider } from './features'
import { useApi } from '@/state/client'

export function CloudFeaturesProvider({ children }: { children: ReactNode }) {
  const catalog = useApi('cloud.catalog', ['cloud'])
  const cloud = catalog.data ?? null
  return <FeaturesProvider value={cloud ? { ...NO_FEATURES, cloud } : NO_FEATURES}>{children}</FeaturesProvider>
}
