import { loadSettings, isCrisisTask, localYMD } from './store'
import { resolveWeatherVisibility, computeWeatherWindow } from './components/WeatherSection'

// Builds the live context object impactRank() (src/scoring.js) consumes —
// one place that knows how to read settings (crisis label, impact_dates)
// and the weather cache, so every surface (Today ordering, Tasks "Impact"
// sort, Next-up scorer) ranks with identical inputs. impactRank itself stays
// pure/import-free so node unit tests can exercise it directly.
export function buildImpactCtx({ labels = [], weatherByDate = null } = {}) {
  const settings = loadSettings() || {}
  const days = weatherByDate ? Object.values(weatherByDate) : []
  const weatherEnabled = days.length > 0
  return {
    todayYmd: localYMD(),
    isCrisis: t => isCrisisTask(t, settings),
    isOutdoor: t => weatherEnabled
      && resolveWeatherVisibility({ task: t, labels, weatherEnabled: true }) === 'visible',
    weatherWindowActive: computeWeatherWindow(days),
    impactDates: Array.isArray(settings.impact_dates) ? settings.impact_dates : [],
  }
}
