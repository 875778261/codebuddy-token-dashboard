export interface Palette {
  dark: boolean
  ink: string
  ink2: string
  ink3: string
  ink4: string
  line: string
  grid: string
  cache: string
  miss: string
  output: string
  credit: string
  accent: string
  ok: string
  models: string[]
  heat: string[]
}

const LIGHT_MODELS = ['#4f5df0', '#0d9d92', '#cf7d1d', '#cf4c7c', '#7c4ff0', '#3f8fd1', '#6f9c3a', '#b0803c']
const DARK_MODELS = ['#7f8bff', '#35c9bb', '#f0a45a', '#f07b9e', '#a58bff', '#5fb0e8', '#9dc463', '#d8a35f']

export function getPalette(dark: boolean): Palette {
  if (dark) {
    return {
      dark,
      ink: '#e9edf6',
      ink2: '#aab5c8',
      ink3: '#828fa4',
      ink4: '#63708a',
      line: 'rgba(255,255,255,0.08)',
      grid: 'rgba(255,255,255,0.07)',
      cache: '#4a86d8',
      miss: '#f0a45a',
      output: '#35c9bb',
      credit: '#a58bff',
      accent: '#7f8bff',
      ok: '#46c79a',
      models: DARK_MODELS,
      heat: ['#1a2029', '#22303f', '#2b4a63', '#356486', '#3f7fab', '#4f9bd0', '#6fb6e6', '#a2d6f7'],
    }
  }
  return {
    dark,
    ink: '#0e1626',
    ink2: '#414e66',
    ink3: '#69758c',
    ink4: '#93a0b4',
    line: 'rgba(15,23,42,0.08)',
    grid: 'rgba(15,23,42,0.07)',
    cache: '#5b8ee6',
    miss: '#e9a05c',
    output: '#12b3a8',
    credit: '#7c4ff0',
    accent: '#4f5df0',
    ok: '#17916f',
    models: LIGHT_MODELS,
    heat: ['#eef1f6', '#dfe6f5', '#c6d3ee', '#a7bce6', '#84a1dd', '#5f83d3', '#4366c4', '#2c4aa8'],
  }
}

export const modelColor = (palette: Palette, index: number) => palette.models[index % palette.models.length]

export function heatColor(palette: Palette, level: number): string {
  const idx = Math.max(0, Math.min(palette.heat.length - 1, level))
  return palette.heat[idx]
}
