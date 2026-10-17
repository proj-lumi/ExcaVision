<script setup lang="ts">
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import type { MarkLineComponentOption } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import VChart from 'vue-echarts'
import { formatAxisTime, formatPhilippineDateTime } from '~/utils/presentation'

use([LineChart, AriaComponent, GridComponent, MarkLineComponent, TooltipComponent, SVGRenderer])

type ChartColor = 'success' | 'warning' | 'error' | 'neutral'
type ChartPoint = { recorded_at: string, value_deg: number | null }
type SeriesPoint = [number, number]
type TooltipEntry = { axisValue?: string | number, value?: number | SeriesPoint }

const props = defineProps<{
  title: string
  points: readonly ChartPoint[]
  threshold: number
  color: ChartColor
  reduceMotion?: boolean
  compact?: boolean
  // ISO timestamp of an alert; drawn as a vertical marker so an alert can always
  // be located on the chart it belongs to.
  markAt?: string | null
}>()

const lineColors: Record<ChartColor, string> = {
  success: 'var(--ui-color-success-500)',
  warning: 'var(--ui-color-warning-500)',
  error: 'var(--ui-color-error-500)',
  neutral: 'var(--ui-text-muted)'
}

// Fixed intervals instead of raw readings. Readings arrive on change (up to once
// a second) or on a 15 s heartbeat, so plotting them against a real time axis
// left visible gaps between points. One point per interval, holding that
// interval's peak tilt, keeps the spacing even and keeps spikes intact.
const BUCKET_STEPS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000]
const LARGEST_BUCKET_MS = 86_400_000
const SMALLEST_BUCKET_MS = 1_000
const MAX_PLOTTED_POINTS = 120

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#39;',
  '"': '&quot;'
})[character] ?? character)

const rawTimes = computed(() => props.points
  .map(point => new Date(point.recorded_at).getTime())
  .filter(time => Number.isFinite(time)))

const spanMs = computed(() => rawTimes.value.length > 1
  ? Math.max(...rawTimes.value) - Math.min(...rawTimes.value)
  : 0)

const bucketMs = computed(() => {
  const target = Math.max(spanMs.value / MAX_PLOTTED_POINTS, SMALLEST_BUCKET_MS)
  return BUCKET_STEPS_MS.find(step => step >= target) ?? LARGEST_BUCKET_MS
})

const bucketLabel = computed(() => {
  const seconds = bucketMs.value / 1000
  if (seconds < 60) return `${seconds} s`
  const minutes = seconds / 60
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} h`
})

const seriesData = computed<SeriesPoint[]>(() => {
  const buckets = new Map<number, number>()
  for (const point of props.points) {
    const time = new Date(point.recorded_at).getTime()
    if (!Number.isFinite(time) || point.value_deg === null) continue
    const key = Math.floor(time / bucketMs.value) * bucketMs.value
    const value = Math.abs(point.value_deg)
    const existing = buckets.get(key)
    buckets.set(key, existing === undefined ? value : Math.max(existing, value))
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([time, value]) => [time, value] as SeriesPoint)
})

const seriesTimes = computed(() => seriesData.value.map(entry => entry[0]))

// Nearest plotted interval to an alert, or -1 when the alert sits outside the
// plotted range (then no marker is drawn).
const markerIndex = computed(() => {
  if (!props.markAt) return -1
  const target = new Date(props.markAt).getTime()
  const times = seriesTimes.value
  if (!Number.isFinite(target) || times.length === 0) return -1
  const first = times[0] ?? 0
  const last = times[times.length - 1] ?? 0
  if (target < first - bucketMs.value || target > last + bucketMs.value) return -1
  let best = 0
  let bestDistance = Number.POSITIVE_INFINITY
  times.forEach((time, index) => {
    const distance = Math.abs(time - target)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
})

// A category axis handed over a label; a time axis hands over a timestamp.
const axisLabel = (value: unknown) => typeof value === 'number'
  ? formatPhilippineDateTime(new Date(value).toISOString())
  : String(value ?? '')

function plottedValue(value: TooltipEntry['value']) {
  return Array.isArray(value) && typeof value[1] === 'number' ? value[1] : null
}

function tooltipText(parameters: unknown) {
  const entry = (Array.isArray(parameters) ? parameters[0] : parameters) as TooltipEntry | undefined
  const value = entry ? plottedValue(entry.value) : null
  if (!entry || value === null) return ''

  const difference = props.threshold - value
  const comparison = difference > 0
    ? `${difference.toFixed(2)}° below threshold`
    : difference < 0
      ? `${Math.abs(difference).toFixed(2)}° above threshold`
      : 'At threshold'

  return [
    `<strong>${escapeHtml(axisLabel(entry.axisValue))}</strong>`,
    `<div style="margin-top:4px;font-family:Inter,ui-sans-serif,system-ui,sans-serif">${value.toFixed(2)}°</div>`,
    `<div style="margin-top:2px;color:var(--ui-text-muted)">peak in this ${bucketLabel.value} interval</div>`,
    `<div style="margin-top:4px;color:var(--ui-text-muted)">${comparison}</div>`
  ].join('')
}

const markLineData = computed<NonNullable<MarkLineComponentOption['data']>>(() => {
  const lines: NonNullable<MarkLineComponentOption['data']> = [{ yAxis: props.threshold }]
  const index = markerIndex.value
  const point = index >= 0 ? seriesData.value[index] : undefined
  if (props.markAt && point) {
    lines.push({
      xAxis: new Date(props.markAt).getTime(),
      lineStyle: { color: 'var(--ui-color-error-500)', type: 'solid', width: 2 },
      label: {
        show: !props.compact,
        formatter: `Alert ${point[1].toFixed(2)}°`,
        position: 'insideEndTop',
        color: 'var(--ui-color-error-500)',
        fontSize: 12
      }
    })
  }
  return lines
})

const option = computed<EChartsOption>(() => ({
  animation: !props.reduceMotion,
  // Live updates arrive every 15 s; animating each one made the line jitter.
  // The first draw still animates, redraws snap into place.
  animationDuration: props.reduceMotion ? 0 : 300,
  animationDurationUpdate: 0,
  aria: {
    enabled: true,
    decal: { show: false },
    label: { description: `${props.title}. Peak tilt per ${bucketLabel.value} compared with a ${props.threshold.toFixed(2)} degree threshold.` }
  },
  grid: props.compact
    ? { left: 4, right: 4, top: 8, bottom: 8, containLabel: false }
    : { left: 52, right: 24, top: 28, bottom: 66, containLabel: false },
  tooltip: {
    trigger: 'axis',
    confine: true,
    formatter: tooltipText,
    backgroundColor: 'var(--ui-bg-elevated)',
    borderColor: 'var(--ui-border-accented)',
    textStyle: { color: 'var(--ui-text-highlighted)', fontSize: 12 },
    axisPointer: {
      type: 'line',
      snap: true,
      lineStyle: { color: 'var(--ui-text-muted)', type: 'dashed', width: 1 }
    }
  },
  xAxis: {
    show: !props.compact,
    type: 'time',
    axisLine: { lineStyle: { color: 'var(--ui-border)' } },
    axisTick: { show: false },
    axisLabel: {
      color: 'var(--ui-text-muted)',
      fontSize: 12,
      hideOverlap: true,
      margin: 14,
      showMinLabel: true,
      showMaxLabel: true,
      formatter: (value: number) => formatAxisTime(value, spanMs.value)
    }
  },
  yAxis: {
    show: !props.compact,
    type: 'value',
    min: 0,
    max: (value: { max: number }) => Math.max(props.threshold, value.max, 1) * 1.1,
    splitNumber: 4,
    axisLabel: { color: 'var(--ui-text-muted)', fontSize: 12, formatter: (value: number) => `${value.toFixed(1)}°` },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: 'var(--ui-border)', opacity: 0.7 } }
  },
  series: [{
    name: 'Peak tilt',
    type: 'line',
    data: seriesData.value,
    connectNulls: false,
    smooth: false,
    showSymbol: !props.compact,
    symbol: 'circle',
    symbolSize: props.compact ? 6 : 8,
    lineStyle: { color: lineColors[props.color], width: props.compact ? 3 : 4, cap: 'round', join: 'round' },
    itemStyle: { color: lineColors[props.color], borderColor: 'var(--ui-bg-elevated)', borderWidth: 2 },
    emphasis: {
      focus: 'none',
      scale: 1.5,
      lineStyle: { color: lineColors[props.color], width: props.compact ? 3 : 4 },
      itemStyle: { color: lineColors[props.color], borderColor: 'var(--ui-bg-elevated)', borderWidth: 2 }
    },
    markLine: {
      silent: true,
      symbol: ['none', 'none'],
      lineStyle: { color: 'var(--ui-color-warning-500)', type: 'dashed', width: 2 },
      label: {
        show: !props.compact,
        formatter: 'Threshold',
        position: 'insideEndTop',
        color: 'var(--ui-color-warning-500)',
        fontSize: 12
      },
      data: markLineData.value
    }
  }]
}))
</script>

<template>
  <div class="w-full" :class="compact ? 'h-24' : 'h-80'">
    <VChart :option="option" :init-options="{ renderer: 'svg' }" autoresize />
  </div>
</template>
