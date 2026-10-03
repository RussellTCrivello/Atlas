import http from 'node:http'

/** Low-level request that lets a test control headers fetch() will not (Host, Origin). */
export function raw(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname + target.search,
        method: options.method || 'GET',
        headers: options.headers
      },
      res => {
        const chunks: Buffer[] = []
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: any = null
          try {
            json = JSON.parse(text)
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode || 0, headers: res.headers, text, json })
        })
      }
    )
    req.on('error', reject)
    if (options.body) req.write(options.body)
    req.end()
  })
}
