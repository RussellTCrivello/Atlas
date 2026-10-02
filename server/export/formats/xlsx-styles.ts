// Cell styles for the workbook writer. A style is a combination of font, fill, border, number format and alignment; the book
// hands out an index for each distinct combination and writes the styles part once at the end.
import type { Tone } from '../model'

export interface FontSpec {
  bold?: boolean
  italic?: boolean
  size?: number
  color?: string // ARGB, e.g. FF1F2937
}
export interface Spec {
  font?: FontSpec
  fill?: string
  border?: 'thin' | 'top' | 'none'
  numFmt?: string
  align?: { h?: 'left' | 'center' | 'right'; v?: 'top' | 'center'; wrap?: boolean }
}

/** One palette for every format: tone -> [background, text]. */
export const TONES: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: 'FFDCFCE7', fg: 'FF166534' },
  warn: { bg: 'FFFEF3C7', fg: 'FF92400E' },
  bad: { bg: 'FFFEE2E2', fg: 'FF991B1B' },
  info: { bg: 'FFDBEAFE', fg: 'FF1E40AF' },
  muted: { bg: 'FFF1F5F9', fg: 'FF475569' }
}

const escape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export class StyleBook {
  private fonts: string[] = ['<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/><family val="2"/></font>']
  private fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>'
  ]
  private borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>']
  private numFmts = new Map<string, number>()
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']
  private cache = new Map<string, number>()

  private index(list: string[], xml: string): number {
    const found = list.indexOf(xml)
    if (found >= 0) return found
    list.push(xml)
    return list.length - 1
  }

  private font(spec: FontSpec = {}): number {
    return this.index(
      this.fonts,
      `<font>${spec.bold ? '<b/>' : ''}${spec.italic ? '<i/>' : ''}<sz val="${spec.size ?? 11}"/><color rgb="${spec.color ?? 'FF1F2937'}"/><name val="Calibri"/><family val="2"/></font>`
    )
  }
  private fill(color?: string): number {
    return color
      ? this.index(
          this.fills,
          `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`
        )
      : 0
  }
  private border(kind: Spec['border'] = 'none'): number {
    if (kind === 'none') return 0
    const side = (name: string, on: boolean, color: string) =>
      on ? `<${name} style="thin"><color rgb="${color}"/></${name}>` : `<${name}/>`
    const all = kind === 'thin'
    return this.index(
      this.borders,
      `<border>${side('left', all, 'FFE2E8F0')}${side('right', all, 'FFE2E8F0')}${side('top', true, all ? 'FFE2E8F0' : 'FF1F2937')}${side('bottom', all, 'FFE2E8F0')}<diagonal/></border>`
    )
  }
  private numFmt(code?: string): number {
    if (!code) return 0
    const builtIn: Record<string, number> = { '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9 }
    if (code in builtIn) return builtIn[code]
    if (!this.numFmts.has(code)) this.numFmts.set(code, 164 + this.numFmts.size)
    return this.numFmts.get(code)!
  }

  /** The style index for a combination (created on first use). */
  xf(spec: Spec = {}): number {
    const key = JSON.stringify(spec)
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const align = spec.align
      ? `<alignment${spec.align.h ? ` horizontal="${spec.align.h}"` : ''}${spec.align.v ? ` vertical="${spec.align.v}"` : ''}${spec.align.wrap ? ' wrapText="1"' : ''}/>`
      : ''
    const font = this.font(spec.font)
    const fill = this.fill(spec.fill)
    const border = this.border(spec.border)
    const numFmt = this.numFmt(spec.numFmt)
    const xml = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`
    this.xfs.push(xml)
    this.cache.set(key, this.xfs.length - 1)
    return this.xfs.length - 1
  }

  toXml(): string {
    const fmts = [...this.numFmts]
      .map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escape(code)}"/>`)
      .join('')
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (fmts ? `<numFmts count="${this.numFmts.size}">${fmts}</numFmts>` : '') +
      `<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join('')}</fills>` +
      `<borders count="${this.borders.length}">${this.borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    )
  }
}
