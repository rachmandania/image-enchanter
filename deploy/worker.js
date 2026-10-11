/**
 * ScanClip's hosting Worker.
 *
 * The whole app is a static Next.js export (no API routes, no server code),
 * so this Worker only serves the prebuilt assets from the ASSETS binding.
 * Any unknown path falls through to the export's 404.html.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request)
  },
}
