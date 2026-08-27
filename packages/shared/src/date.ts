/** 将时间转换为当前时区的 YYYY-MM-DD，供 CLI、Web 与 MCP 统一筛选口径。 */
export function formatLocalDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
