export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { model, max_tokens, messages } = req.body

  const response = await fetch('/api/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model, max_tokens, messages })
  })

  const data = await response.json()
  res.status(200).json(data)
}
