// Feature registry access for the UI: the context feeds `resolveFeatures`. Until the engine / key store / accounts
// exist (later lots) the context is "nothing connected", so everything that needs them shows as demo.
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  featureState,
  NO_FEATURES,
  resolveFeatures,
  type FeatureContext,
  type FeatureId,
  type FeatureState
} from '../../shared/features'

const FeaturesContext = createContext<FeatureContext>(NO_FEATURES)

export function FeaturesProvider({ value, children }: { value: FeatureContext; children: ReactNode }) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>
}

export function useFeature(id: FeatureId): FeatureState {
  const ctx = useContext(FeaturesContext)
  return useMemo(() => featureState(id, ctx), [id, ctx])
}

export function useFeatures(): FeatureState[] {
  const ctx = useContext(FeaturesContext)
  return useMemo(() => resolveFeatures(ctx), [ctx])
}
