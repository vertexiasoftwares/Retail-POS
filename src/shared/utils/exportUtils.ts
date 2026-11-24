/**
 * Export utilities for Excel (.xls spreadsheet) and PDF (formatted printable report)
 */

export type ExportPayload = {
  filename: string
  title: string
  subtitle?: string
  headers: string[]
  rows: (string | number)[][]
}

/**
 * Exports data to a Microsoft Excel-compatible spreadsheet (.xls)
 * Opens cleanly in Microsoft Excel, Google Sheets, and LibreOffice with styling.
 */
export function exportToExcel({
  filename,
  title,
  subtitle,
  headers,
  rows,
}: ExportPayload) {
  const safeFilename = filename.endsWith('.xls') || filename.endsWith('.xlsx')
    ? filename
    : `${filename}.xls`

  const dateStr = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })

  const headerCells = headers
    .map(h => `<th style="background-color: #2563eb; color: #ffffff; font-weight: bold; padding: 10px 14px; border: 1px solid #cbd5e1; font-size: 13px; text-align: left;">${escapeXml(h)}</th>`)
    .join('')

  const rowCells = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
      const cells = row
        .map(cell => {
          const val = cell === null || cell === undefined ? '' : String(cell)
          const isNum = typeof cell === 'number' || (!isNaN(Number(val)) && val.trim() !== '')
          const align = isNum ? 'right' : 'left'
          return `<td style="padding: 8px 14px; border: 1px solid #e2e8f0; font-size: 12.5px; text-align: ${align}; color: #1e293b; background-color: ${bg};">${escapeXml(val)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  const html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
  <!--[if gte mso 9]>
  <xml>
    <x:ExcelWorkbook>
      <x:ExcelWorksheets>
        <x:ExcelWorksheet>
          <x:Name>${escapeXml(title.slice(0, 30))}</x:Name>
          <x:WorksheetOptions>
            <x:DisplayGridlines/>
          </x:WorksheetOptions>
        </x:ExcelWorksheet>
      </x:ExcelWorksheets>
    </x:ExcelWorkbook>
  </xml>
  <![endif]-->
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    .report-title { font-size: 18px; font-weight: bold; color: #0f172a; padding: 10px 0 4px; }
    .report-meta { font-size: 12px; color: #64748b; padding-bottom: 12px; }
  </style>
</head>
<body>
  <table>
    <tr>
      <td colspan="${headers.length}" class="report-title">${escapeXml(title)}</td>
    </tr>
    <tr>
      <td colspan="${headers.length}" class="report-meta">
        ${subtitle ? escapeXml(subtitle) + ' | ' : ''}Generated: ${dateStr} | Total Records: ${rows.length}
      </td>
    </tr>
    <tr></tr>
    <thead>
      <tr>${headerCells}</tr>
    </thead>
    <tbody>
      ${rowCells}
    </tbody>
  </table>
</body>
</html>
`

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = safeFilename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Exports data as a high-resolution, branded printable PDF view.
 * Opens the system print/PDF dialog directly.
 */
export function exportToPdf({
  title,
  subtitle,
  headers,
  rows,
}: Omit<ExportPayload, 'filename'>) {
  const dateStr = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' })

  const headerHtml = headers
    .map(h => `<th style="background-color: #1e293b; color: #ffffff; padding: 9px 12px; font-size: 12px; text-align: left; border: 1px solid #334155; font-weight: 600;">${escapeXml(h)}</th>`)
    .join('')

  const rowsHtml = rows
    .map((row, idx) => {
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc'
      const cells = row
        .map(cell => {
          const val = cell === null || cell === undefined ? '' : String(cell)
          const isNum = typeof cell === 'number' || (!isNaN(Number(val)) && val.trim() !== '')
          const align = isNum ? 'right' : 'left'
          return `<td style="padding: 7px 12px; border: 1px solid #e2e8f0; font-size: 11.5px; text-align: ${align}; color: #1e293b; background-color: ${bg};">${escapeXml(val)}</td>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')

  const printWindow = window.open('', '_blank', 'width=1000,height=750')
  if (!printWindow) {
    alert('Please allow popups to generate and print PDF reports.')
    return
  }

  printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeXml(title)}</title>
  <style>
    @page { size: landscape; margin: 12mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 16px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px; }
    .brand h1 { margin: 0; font-size: 20px; font-weight: 800; color: #1e3a8a; }
    .brand p { margin: 3px 0 0; font-size: 12px; color: #64748b; }
    .meta { text-align: right; font-size: 11px; color: #64748b; }
    .meta strong { color: #0f172a; display: block; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .footer { margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>Vertexia Retail POS</h1>
      <p>${escapeXml(title)} ${subtitle ? '— ' + escapeXml(subtitle) : ''}</p>
    </div>
    <div class="meta">
      <strong>Total Records: ${rows.length}</strong>
      <span>Printed: ${dateStr}</span>
    </div>
  </div>

  <table>
    <thead>
      <tr>${headerHtml}</tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <span>Vertexia Retail POS System • Generated Report</span>
    <span>Page 1 of 1</span>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 250);
    };
  </script>
</body>
</html>
`)
  printWindow.document.close()
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
