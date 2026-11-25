/**
 * Export utilities for genuine Microsoft Excel (.xlsx OOXML) and direct binary PDF download
 */

export type ExportPayload = {
  filename: string
  title: string
  subtitle?: string
  headers: string[]
  rows: (string | number)[][]
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 2500)
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Strip illegal XML 1.0 control characters so Excel/Sheets never report file corruption.
 */
function sanitizeXmlText(val: string): string {
  // Keep tab (0x09), LF (0x0A), CR (0x0D); strip other 0x00-0x1F control chars
  return val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
}

function excelColName(indexZeroBased: number): string {
  let n = indexZeroBased + 1
  let col = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    col = String.fromCharCode(65 + rem) + col
    n = Math.floor((n - 1) / 26)
  }
  return col
}

// Precomputed CRC-32 lookup table for standard PKZIP archives
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Minimal, standards-compliant STORE-method PKZIP archive builder.
 * Produces valid ZIP/OOXML packages readable by Microsoft Excel, Google Sheets, LibreOffice, and Excel viewers.
 */
function buildZip(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const encoder = new TextEncoder()
  const now = new Date()
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f)
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f)

  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true) // Local file header signature
    lv.setUint16(4, 20, true) // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true) // UTF-8 filename flag
    lv.setUint16(8, 0, true) // Compression: 0 = STORE
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true) // Extra field length
    localHeader.set(nameBytes, 30)

    localParts.push(localHeader, entry.data)

    // Central directory header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true) // Central directory signature
    cv.setUint16(4, 20, true) // Version made by
    cv.setUint16(6, 20, true) // Version needed
    cv.setUint16(8, 0x0800, true) // UTF-8 filename flag
    cv.setUint16(10, 0, true) // Compression: STORE
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true) // Extra length
    cv.setUint16(32, 0, true) // Comment length
    cv.setUint16(34, 0, true) // Disk number
    cv.setUint16(36, 0, true) // Internal attrs
    cv.setUint32(38, 0, true) // External attrs
    cv.setUint32(42, offset, true) // Relative offset of local header
    centralHeader.set(nameBytes, 46)

    centralParts.push(centralHeader)
    offset += localHeader.length + size
  }

  let centralSize = 0
  for (const cp of centralParts) centralSize += cp.length

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // EOCD signature
  ev.setUint16(4, 0, true) // Disk number
  ev.setUint16(6, 0, true) // Start disk
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true) // Comment length

  const totalLength = offset + centralSize + eocd.length
  const out = new Uint8Array(totalLength)
  let pos = 0
  for (const lp of localParts) {
    out.set(lp, pos)
    pos += lp.length
  }
  for (const cp of centralParts) {
    out.set(cp, pos)
    pos += cp.length
  }
  out.set(eocd, pos)
  return out
}

/**
 * Builds the raw bytes of a valid OOXML Microsoft Excel (.xlsx) workbook.
 */
export function buildXlsxBytes({
  title,
  subtitle,
  headers,
  rows,
}: Omit<ExportPayload, 'filename'>): Uint8Array {
  const dateStr = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })
  const metaLine = [subtitle, `Generated: ${dateStr}`, `Total Records: ${rows.length}`]
    .filter(Boolean)
    .join(' | ')

  // Shared strings table deduplication for clean universal Excel compatibility
  const sharedStrings: string[] = []
  const stringIndex = new Map<string, number>()
  const internString = (raw: string): number => {
    const clean = sanitizeXmlText(raw)
    const existing = stringIndex.get(clean)
    if (existing !== undefined) return existing
    const idx = sharedStrings.length
    sharedStrings.push(clean)
    stringIndex.set(clean, idx)
    return idx
  }

  // Track column widths (in character units)
  const colCount = Math.max(1, headers.length)
  const colWidths = new Array<number>(colCount).fill(12)
  for (let c = 0; c < headers.length; c++) {
    colWidths[c] = Math.min(44, Math.max(12, (headers[c]?.length ?? 8) + 4))
  }
  for (const row of rows) {
    for (let c = 0; c < colCount; c++) {
      const len = String(row?.[c] ?? '').length + 3
      if (len > colWidths[c]) colWidths[c] = Math.min(44, len)
    }
  }

  const sheetRowsXml: string[] = []

  // Row 1: Report Title (style 1)
  const titleIdx = internString(title || 'Report')
  sheetRowsXml.push(
    `<row r="1" ht="24" customHeight="1"><c r="A1" t="s" s="1"><v>${titleIdx}</v></c></row>`
  )

  // Row 2: Subtitle / Metadata (style 2)
  const metaIdx = internString(metaLine)
  sheetRowsXml.push(
    `<row r="2" ht="18" customHeight="1"><c r="A2" t="s" s="2"><v>${metaIdx}</v></c></row>`
  )

  // Row 3: Blank spacer row
  // Row 4: Table Headers (style 3)
  const headerCellsXml = headers
    .map((h, c) => {
      const ref = `${excelColName(c)}4`
      const sIdx = internString(h ?? '')
      return `<c r="${ref}" t="s" s="3"><v>${sIdx}</v></c>`
    })
    .join('')
  sheetRowsXml.push(`<row r="4" ht="22" customHeight="1">${headerCellsXml}</row>`)

  // Row 5+: Data Rows (style 0 on even, style 4 on odd zebra rows)
  for (let r = 0; r < rows.length; r++) {
    const excelRowNum = 5 + r
    const styleId = r % 2 === 1 ? 4 : 0
    const row = rows[r] ?? []
    const cellsXml: string[] = []
    for (let c = 0; c < headers.length; c++) {
      const ref = `${excelColName(c)}${excelRowNum}`
      const cell = row[c]
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        cellsXml.push(`<c r="${ref}" t="n" s="${styleId}"><v>${cell}</v></c>`)
      } else {
        const strVal = cell === null || cell === undefined ? '' : String(cell)
        const sIdx = internString(strVal)
        cellsXml.push(`<c r="${ref}" t="s" s="${styleId}"><v>${sIdx}</v></c>`)
      }
    }
    sheetRowsXml.push(`<row r="${excelRowNum}">${cellsXml.join('')}</row>`)
  }

  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  const lastCol = excelColName(colCount - 1)
  const lastRow = Math.max(4, 4 + rows.length)
  const sheetName = sanitizeXmlText((title || 'Report').replace(/[\\/?*[\]:]/g, ' ').trim()).slice(0, 31) || 'Report'

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF1E293B"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><color rgb="FF0F172A"/><name val="Calibri"/></font>
    <font><sz val="10"/><color rgb="FF475569"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="5">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
</styleSheet>`

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map(s => `  <si><t xml:space="preserve">${escapeXml(s)}</t></si>`).join('\n')}
</sst>`

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastCol}${lastRow}"/>
  <sheetViews>
    <sheetView workbookViewId="0">
      <pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${colsXml}</cols>
  <sheetData>
    ${sheetRowsXml.join('\n    ')}
  </sheetData>
</worksheet>`

  const encoder = new TextEncoder()
  return buildZip([
    { name: '[Content_Types].xml', data: encoder.encode(contentTypesXml) },
    { name: '_rels/.rels', data: encoder.encode(rootRelsXml) },
    { name: 'xl/workbook.xml', data: encoder.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRelsXml) },
    { name: 'xl/styles.xml', data: encoder.encode(stylesXml) },
    { name: 'xl/sharedStrings.xml', data: encoder.encode(sharedStringsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(worksheetXml) },
  ])
}

/**
 * Exports data as a genuine Microsoft Excel workbook (.xlsx) — opens cleanly in Excel, Google Sheets, LibreOffice, and Excel viewers.
 */
export function exportToExcel({
  filename,
  title,
  subtitle,
  headers,
  rows,
}: ExportPayload) {
  const safeFilename =
    (filename || title || 'report')
      .replace(/\.(xls|xlsx|csv|pdf)$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.xlsx'

  const xlsxBytes = buildXlsxBytes({ title, subtitle, headers, rows })
  const blob = new Blob([xlsxBytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  triggerDownload(blob, safeFilename)
}

/**
 * Sanitizes text to printable ASCII for standard PDF Type1 Helvetica font and escapes PDF string literals.
 */
function pdfText(input: string): string {
  const ascii = input
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
  return ascii.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function fitText(raw: string, maxWidthPt: number, fontSize: number): string {
  const clean = raw
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .trim()
  const avgCharW = fontSize * 0.51
  const maxChars = Math.max(3, Math.floor(maxWidthPt / avgCharW))
  if (clean.length <= maxChars) return clean
  return maxChars <= 4 ? clean.slice(0, maxChars) : clean.slice(0, maxChars - 3) + '...'
}

function isNumericCell(cell: string | number | null | undefined): boolean {
  if (typeof cell === 'number') return true
  if (cell === null || cell === undefined) return false
  const s = String(cell).trim()
  if (!s) return false
  return /^-?Rs\.?\s*[\d,.]+$/i.test(s) || !isNaN(Number(s.replace(/,/g, '')))
}

/**
 * Generates a real multi-page A4 landscape PDF file and downloads it directly (.pdf) without opening any preview popup.
 */
export function exportToPdf({
  filename,
  title,
  subtitle,
  headers,
  rows,
}: Omit<ExportPayload, 'filename'> & { filename?: string }) {
  const baseName =
    (filename || title || 'report')
      .replace(/\.(xls|xlsx|csv|pdf)$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report'
  const safeFilename = `${baseName}.pdf`
  const dateStr = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })

  const pageW = 841.89
  const pageH = 595.28
  const marginX = 28
  const contentW = pageW - marginX * 2
  const headerTopY = pageH - 32
  const tableTopFirst = pageH - 96
  const footerY = 26
  const rowH = 18
  const thH = 22

  const colCount = Math.max(1, headers.length)
  const weights = headers.map((h, colIdx) => {
    let maxLen = h.length
    const sampleLimit = Math.min(rows.length, 60)
    for (let r = 0; r < sampleLimit; r++) {
      const val = String(rows[r]?.[colIdx] ?? '')
      if (val.length > maxLen) maxLen = val.length
    }
    return Math.min(34, Math.max(6, maxLen))
  })
  const totalWeight = weights.reduce((s, w) => s + w, 0) || colCount
  const colWidths = weights.map(w => (w / totalWeight) * contentW)

  const usableTableH = tableTopFirst - thH - (footerY + 18)
  const rowsPerPage = Math.max(1, Math.floor(usableTableH / rowH))
  const totalPages = Math.max(1, Math.ceil(rows.length / rowsPerPage))

  const pageStreams: string[] = []

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const startRow = pageIdx * rowsPerPage
    const pageRows = rows.slice(startRow, startRow + rowsPerPage)
    const ops: string[] = []

    ops.push(
      `BT /F2 16 Tf 0.118 0.227 0.541 rg ${marginX.toFixed(2)} ${headerTopY.toFixed(2)} Td (${pdfText('Vertexia Retail POS')}) Tj ET`
    )
    const titleLine = subtitle ? `${title} - ${subtitle}` : title
    ops.push(
      `BT /F1 9.5 Tf 0.392 0.455 0.545 rg ${marginX.toFixed(2)} ${(headerTopY - 16).toFixed(2)} Td (${pdfText(fitText(titleLine, 540, 9.5))}) Tj ET`
    )

    const countText = `Total Records: ${rows.length}`
    const printedText = `Printed: ${dateStr}`
    const rightX1 = pageW - marginX - Math.min(200, countText.length * 5.2)
    const rightX2 = pageW - marginX - Math.min(240, printedText.length * 4.5)
    ops.push(
      `BT /F2 9.5 Tf 0.059 0.090 0.165 rg ${rightX1.toFixed(2)} ${headerTopY.toFixed(2)} Td (${pdfText(countText)}) Tj ET`
    )
    ops.push(
      `BT /F1 8.5 Tf 0.392 0.455 0.545 rg ${rightX2.toFixed(2)} ${(headerTopY - 15).toFixed(2)} Td (${pdfText(printedText)}) Tj ET`
    )

    ops.push(
      `0.145 0.388 0.922 RG 1.8 w ${marginX.toFixed(2)} ${(headerTopY - 28).toFixed(2)} m ${(pageW - marginX).toFixed(2)} ${(headerTopY - 28).toFixed(2)} l S`
    )

    const thBottom = tableTopFirst - thH
    ops.push(
      `0.118 0.161 0.231 rg ${marginX.toFixed(2)} ${thBottom.toFixed(2)} ${contentW.toFixed(2)} ${thH.toFixed(2)} re f`
    )

    let curX = marginX
    for (let c = 0; c < headers.length; c++) {
      const cw = colWidths[c]
      const text = fitText(headers[c] ?? '', cw - 10, 8.5)
      ops.push(
        `BT /F2 8.5 Tf 1 1 1 rg ${(curX + 5).toFixed(2)} ${(thBottom + 7).toFixed(2)} Td (${pdfText(text)}) Tj ET`
      )
      curX += cw
    }

    if (pageRows.length === 0) {
      const emptyBottom = thBottom - rowH
      ops.push(
        `0.886 0.910 0.941 RG 0.5 w ${marginX.toFixed(2)} ${emptyBottom.toFixed(2)} ${contentW.toFixed(2)} ${rowH.toFixed(2)} re S`
      )
      ops.push(
        `BT /F1 9 Tf 0.392 0.455 0.545 rg ${(marginX + 8).toFixed(2)} ${(emptyBottom + 5.5).toFixed(2)} Td (${pdfText('No records available for this report.')}) Tj ET`
      )
    } else {
      for (let r = 0; r < pageRows.length; r++) {
        const row = pageRows[r]
        const rowBottom = thBottom - (r + 1) * rowH
        if (r % 2 === 1) {
          ops.push(
            `0.973 0.980 0.988 rg ${marginX.toFixed(2)} ${rowBottom.toFixed(2)} ${contentW.toFixed(2)} ${rowH.toFixed(2)} re f`
          )
        }
        ops.push(
          `0.886 0.910 0.941 RG 0.5 w ${marginX.toFixed(2)} ${rowBottom.toFixed(2)} ${contentW.toFixed(2)} ${rowH.toFixed(2)} re S`
        )

        curX = marginX
        for (let c = 0; c < headers.length; c++) {
          const cw = colWidths[c]
          const rawCell = row?.[c]
          const rawStr = rawCell === null || rawCell === undefined ? '' : String(rawCell)
          const text = fitText(rawStr, cw - 10, 8)
          const numeric = isNumericCell(rawCell)
          const estW = text.length * 4.2
          const tx = numeric ? Math.max(curX + 4, curX + cw - 5 - estW) : curX + 5
          ops.push(
            `BT /F1 8 Tf 0.118 0.161 0.231 rg ${tx.toFixed(2)} ${(rowBottom + 5.5).toFixed(2)} Td (${pdfText(text)}) Tj ET`
          )
          if (c > 0) {
            ops.push(
              `0.886 0.910 0.941 RG 0.4 w ${curX.toFixed(2)} ${rowBottom.toFixed(2)} m ${curX.toFixed(2)} ${(rowBottom + rowH).toFixed(2)} l S`
            )
          }
          curX += cw
        }
      }
    }

    ops.push(
      `0.886 0.910 0.941 RG 0.6 w ${marginX.toFixed(2)} ${(footerY + 12).toFixed(2)} m ${(pageW - marginX).toFixed(2)} ${(footerY + 12).toFixed(2)} l S`
    )
    ops.push(
      `BT /F1 8 Tf 0.580 0.639 0.722 rg ${marginX.toFixed(2)} ${footerY.toFixed(2)} Td (${pdfText('Vertexia Retail POS System - Generated Report')}) Tj ET`
    )
    const pageLabel = `Page ${pageIdx + 1} of ${totalPages}`
    ops.push(
      `BT /F1 8 Tf 0.580 0.639 0.722 rg ${(pageW - marginX - pageLabel.length * 4.3).toFixed(2)} ${footerY.toFixed(2)} Td (${pdfText(pageLabel)}) Tj ET`
    )

    pageStreams.push(ops.join('\n'))
  }

  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let totalBytes = 0

  const pushStr = (s: string) => {
    const bytes = encoder.encode(s)
    chunks.push(bytes)
    totalBytes += bytes.length
  }

  pushStr('%PDF-1.4\n')

  const pageObjNums: number[] = []
  const contentObjNums: number[] = []
  let nextObjNum = 5
  for (let i = 0; i < totalPages; i++) {
    pageObjNums.push(nextObjNum++)
    contentObjNums.push(nextObjNum++)
  }

  offsets[1] = totalBytes
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  offsets[2] = totalBytes
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map(n => `${n} 0 R`).join(' ')}] /Count ${totalPages} >>\nendobj\n`
  )

  offsets[3] = totalBytes
  pushStr('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  offsets[4] = totalBytes
  pushStr('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n')

  for (let i = 0; i < totalPages; i++) {
    const pObj = pageObjNums[i]
    const cObj = contentObjNums[i]
    const streamStr = pageStreams[i]
    const streamLen = encoder.encode(streamStr).length

    offsets[pObj] = totalBytes
    pushStr(
      `${pObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cObj} 0 R >>\nendobj\n`
    )

    offsets[cObj] = totalBytes
    pushStr(`${cObj} 0 obj\n<< /Length ${streamLen} >>\nstream\n${streamStr}\nendstream\nendobj\n`)
  }

  const xrefOffset = totalBytes
  const objCount = nextObjNum
  pushStr(`xref\n0 ${objCount}\n`)
  pushStr('0000000000 65535 f \n')
  for (let i = 1; i < objCount; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  pushStr(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const pdfBuffer = new Uint8Array(totalBytes)
  let pos = 0
  for (const chunk of chunks) {
    pdfBuffer.set(chunk, pos)
    pos += chunk.length
  }

  const blob = new Blob([pdfBuffer], { type: 'application/pdf' })
  triggerDownload(blob, safeFilename)
}
