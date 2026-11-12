import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

// Renders a scannable barcode as SVG (crisp when printed).
export function Barcode({ value, format = 'UPC', height = 40, width = 1.6, fontSize = 12, displayValue = true }: {
  value: string; format?: 'UPC' | 'CODE128'; height?: number; width?: number; fontSize?: number; displayValue?: boolean
}) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    try {
      JsBarcode(ref.current, value, { format, height, width, fontSize, displayValue, margin: 0, background: 'transparent' })
    } catch {
      // A value that isn't valid UPC (e.g. a hand-typed barcode) falls back to Code 128.
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, displayValue, margin: 0, background: 'transparent' })
    }
  }, [value, format, height, width, fontSize, displayValue])
  return <svg ref={ref} />
}
