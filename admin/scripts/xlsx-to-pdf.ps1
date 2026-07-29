<#
  Converts an .xlsx workbook to .pdf using Excel COM automation (every sheet in the
  workbook becomes page(s) in the PDF, in sheet order, using each sheet's own page setup).
  Requires Microsoft Excel to be installed. Runs a separate invisible Excel instance,
  so it does not disturb any Excel windows you already have open.
#>
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$InputPath = (Resolve-Path $InputPath).Path

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Open($InputPath)
  # 0 = xlTypePDF
  $wb.ExportAsFixedFormat(0, $OutputPath)
  $wb.Close($false)
  Write-Output "Wrote $OutputPath"
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
