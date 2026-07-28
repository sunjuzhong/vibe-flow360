export type StreamEvent = {
  type: 'start' | 'delta' | 'done' | 'error'
  delta?: string
  error?: string
}

export async function readSSE(
  response: Response,
  onEvent: (event: StreamEvent) => void,
) {
  if (!response.body) throw new Error('响应不支持流式读取')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const line = frame
        .split('\n')
        .find((item) => item.startsWith('data: '))
      if (!line) continue
      onEvent(JSON.parse(line.slice(6)) as StreamEvent)
    }

    if (done) break
  }
}

