export default function handler(req, res) {
  res.status(200).json({ ok: true, from: 'catchall-selfcontained', path: req.url });
}
