// The classic Today screen (TodayView) is GATED OFF, not deleted (BOOM-33,
// 2026-11-15). It was the points screen — a points-goal arc and a day-rally
// chip — and points and rally left the product. Ryan isn't ready to delete
// it, so the component stays in the tree and this one flag is the way back:
// flip it to true and both the Settings switch and the stored
// `settings.today_classic` preference work again. While it's false a stored
// `today_classic: true` is ignored, so nobody lands on a screen with its
// score removed.
export const CLASSIC_TODAY_ENABLED = false

export const classicTodayOn = (settings) => CLASSIC_TODAY_ENABLED && !!settings?.today_classic
