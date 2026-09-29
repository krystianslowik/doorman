# Doorman

<p align="center">
  <img src="docs/doorman-readme.svg" width="520" alt="An email entering a doorway and receiving separate free and disposable flags">
</p>

**Doorman is an email-domain API.** It returns separate `free` and `disposable` flags for an address or domain. It checks domain lists; it does not verify that a mailbox exists.

## Try the demo

The [public demo](https://doorman.krystianslowik.com/v1/check?email=jane@gmail.com) needs no API key. It allows **five requests per rolling hour per client** (one IPv4 address or IPv6 `/64`); a batch counts as one request.

Check one address:

```bash
curl "https://doorman.krystianslowik.com/v1/check?email=jane@gmail.com"
```

```json
{ "input": "jane@gmail.com", "domain": "gmail.com", "free": true, "disposable": false }
```

Check several in one request:

```bash
curl -H "Content-Type: application/json" \
  -d '{"emails":["jane@gmail.com","jane@mailinator.com","jane@acme.com"]}' \
  https://doorman.krystianslowik.com/v1/check
```

```json
{
  "results": [
    { "input": "jane@gmail.com", "domain": "gmail.com", "free": true, "disposable": false },
    { "input": "jane@mailinator.com", "domain": "mailinator.com", "free": true, "disposable": true },
    { "input": "jane@acme.com", "domain": "acme.com", "free": false, "disposable": false }
  ]
}
```

Both flags can be `true`. If both are `false`, neither list matched; that does not prove the address belongs to a company. The lists are committed in [`data/`](data/) and bundled with the service, so checks need no outbound internet access. You can [review their sources](#sources) and [refresh them](#refreshing-the-domain-lists) when needed.

## Run locally

Requires Node.js 24 or newer.

```bash
cp .env.example .env
# Set DOORMAN_API_KEY=local-test-key in .env
npm ci
npm run dev
```

In another terminal:

```bash
curl -H "Authorization: Bearer local-test-key" \
  "http://localhost:3851/v1/check?email=jane@gmail.com"
```

```json
{ "input": "jane@gmail.com", "domain": "gmail.com", "free": true, "disposable": false }
```

The service also runs in Docker or as a Cloudflare Worker. See [local development](#local-development) and [deployment](#deploy-to-cloudflare) for those paths.

## API

The Cloudflare Worker accepts anonymous `/v1/check` requests within its rate limit. Node and Docker runs require `Authorization: Bearer <API key>`. `/health` is public in both runtimes.

### `GET /v1/check?email=<email-or-domain>`

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:3851/v1/check?email=jane@mailinator.com"
```

```json
{ "input": "jane@mailinator.com", "domain": "mailinator.com", "free": true, "disposable": true }
```

### `POST /v1/check`

Single value: `{"email": "jane@gmail.com"}`. Batch: `{"emails": [...]}`. The Worker accepts up to 100 items; Node and Docker use `MAX_BATCH_SIZE` (default 100).

```bash
curl -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"emails": ["a@gmail.com", "b@acme.com", "bad"]}' \
  http://localhost:3851/v1/check
```

```json
{
  "results": [
    { "input": "a@gmail.com", "domain": "gmail.com", "free": true, "disposable": false },
    { "input": "b@acme.com", "domain": "acme.com", "free": false, "disposable": false },
    { "input": "bad", "error": "not a valid email address or domain" }
  ]
}
```

Prefer `POST` for real people's emails. Query strings are commonly recorded in access logs; request bodies are less likely to be logged, though your infrastructure may still capture them.

### Semantics

- Input can be a full email or a bare domain. The host is trimmed, lowercased and converted to punycode for lookup, so an internationalized domain and a mixed-case one both match. The `input` field preserves the submitted value.
- The GET query keeps a literal `+`, so `?email=jane+tag@gmail.com` checks `jane+tag@gmail.com`.
- The lookup checks the full host and each parent down to its registrable domain, never further: `x@0.mail.mujur.id` checks `0.mail.mujur.id`, then `mail.mujur.id`, then `mujur.id`. The `domain` field is that registrable domain.
- Private suffixes count, so a lookup for `foo.github.io` treats `foo.github.io` itself as the registrable domain instead of climbing further up to `github.io`.
- IP addresses, URL fragments (`gmail.com/acme.com`) and hosts with no registrable domain (a bare public suffix such as `github.io`, or a single label such as `localhost`) are rejected as invalid input.
- Every disposable domain also counts as free, so `disposable: true` always comes with `free: true`. Use `free && !disposable` for "regular free provider".
- The lists aren't complete. A domain missing from both lists comes back as `free: false`. See [Adding or removing a domain by hand](#adding-or-removing-a-domain-by-hand).
- Status codes: `200` success (in a batch, invalid items carry an `error` field instead), `400` invalid input or body, `401` missing or wrong token where a key is required or supplied, `404`/`405` unknown route or method, `413` body over 64 KiB, `429` anonymous Worker limit reached, and `500` unexpected error.

## Authentication

Bearer API keys are set in `DOORMAN_API_KEY`: one key, or a comma-separated list. Give each client its own key so you can revoke one without affecting the others. The scheme is case-insensitive (`Bearer`, `bearer`, `BEARER` all work).

```bash
openssl rand -hex 32   # generate a key
```

On Cloudflare, requests without an `Authorization` header are anonymous and rate limited. A request that includes the header must use a valid key; valid keys bypass the anonymous limit, and invalid keys receive `401`. Node and Docker require a key for every `/v1/check` request and refuse to start without `DOORMAN_API_KEY`.

## Rate limits

The Worker allows **five anonymous requests per rolling hour** per IPv4 address or IPv6 `/64`. A batch counts as one request. Valid bearer-key requests are not limited. Anonymous responses include `ratelimit-limit` and `ratelimit-remaining` headers; a `429` response also includes `retry-after` in seconds and `{"error":"Rate limit exceeded, retry later or use an API key"}`.

Node and Docker have no anonymous mode or built-in rate limit.

## Local development

Node, Docker, and Wrangler can read the same `.env` file, which is gitignored:

```bash
cp .env.example .env    # set DOORMAN_API_KEY, e.g. local-test-key
npm ci
npm test
```

### Node (fastest loop)

```bash
npm run dev             # loads .env, restarts on file changes, http://localhost:3851
curl http://localhost:3851/health
curl -H "Authorization: Bearer local-test-key" "http://localhost:3851/v1/check?email=a@gmail.com"
```

### Docker

```bash
docker build -t doorman .
docker run --rm -p 3851:3851 --env-file .env doorman
```

The current Dockerfile builds a `linux/amd64` image. On Apple Silicon, Docker may warn and run it under emulation.

### Cloudflare Worker (`wrangler dev`)

```bash
npx wrangler dev        # loads DOORMAN_API_KEY from .env, http://localhost:8787
curl -H "Authorization: Bearer local-test-key" "http://localhost:8787/v1/check?email=a@gmail.com"
```

The Worker bundles the committed domain lists and checks requests itself. Its `MAX_BATCH_SIZE` is fixed at 100; the `.env` setting applies only to Node and Docker.

## Deploy to Cloudflare

You need a Cloudflare account with Workers enabled. Docker is not needed for this deployment.

1. Deploy: `npx wrangler deploy`. Wrangler bundles the Worker and domain lists, configures its rate-limit Durable Object, and prints the Worker URL (`https://doorman.<your-subdomain>.workers.dev`).
2. To allow authenticated, unlimited requests, set the key as a secret: `npx wrangler secret put DOORMAN_API_KEY`, then enter `key1,key2`. Without a key, callers can still use the anonymous limit.
3. Verify:

   ```bash
   curl https://doorman.<your-subdomain>.workers.dev/health
   curl "https://doorman.<your-subdomain>.workers.dev/v1/check?email=a@gmail.com"
   # If you set DOORMAN_API_KEY:
   curl -H "Authorization: Bearer $API_KEY" "https://doorman.<your-subdomain>.workers.dev/v1/check?email=a@gmail.com"
   ```

The demo's custom hostname is configured outside `wrangler.jsonc`; deploying this repository alone does not attach your own domain. To rotate keys, set `DOORMAN_API_KEY` to both old and new keys, move clients over, then remove the old one. The Worker reads the current secret on each request; no code redeploy is needed.

Elsewhere, run the Docker image with `DOORMAN_API_KEY` set.

## Refreshing the domain lists

The service reads its data only from the committed files in [`data/`](data/):

| File | Contents |
|---|---|
| `free.txt` | Free email providers (Gmail, Outlook, …). Rebuilt by `update-data`. |
| `disposable.txt` | Disposable / temporary email providers. Rebuilt by `update-data`. |
| `manual-free.txt` | Free providers added by hand, with a dated `#` comment per addition. Hand-edited, never rewritten by `update-data`. |
| `blacklist.txt` | Domains never to list, such as universities and company domains that upstream free lists include, so they read as organisations. A leading `.` (e.g. `.ddns.org`) also excludes its subdomains. Hand-edited, never rewritten by `update-data`. |
| `sources.json` | Upstream URLs the refresh downloads from, grouped into `free` and `disposable` |

`npm run update-data` rebuilds `free.txt` and `disposable.txt` from scratch out of `sources.json`, `manual-free.txt` and `blacklist.txt`. Refreshing is manual; a good time to do it is before a deploy, or when you find a domain the service misclassified.

### Steps

```bash
npm ci
npm run update-data     # downloads every source in data/sources.json and rewrites free.txt/disposable.txt
npm test                # checks list integrity and that well-known domains are classified correctly
git diff --stat data/   # review what changed
```

The script prints how many valid and invalid domains each source returned, then a summary like this one:

```
Result:
  disposable.txt  78141 -> 78163  (+31 / -9)
  free.txt        5417 -> 5419  (+3 / -1)
Review with `git diff --stat data/` and commit the changes.
```

The "invalid" entries are rows a source shipped that don't parse as a domain, plus bare public/private suffixes such as `dyndns.org` or `net.ua`, which are dropped because they could never match a query. If the numbers look sensible, commit the `data/` changes. The Worker bundles the lists, the Docker image copies them, and Node loads them at startup. Redeploy the Worker, rebuild the Docker image, or restart Node to use updated lists.

### What the refresh does

- **Rebuilds from scratch every run:** `free.txt` and `disposable.txt` are entirely replaced from `sources.json`, `manual-free.txt` and `blacklist.txt`. An upstream removal propagates instead of leaving a stale entry behind.
- **Precedence:** `manual-free.txt` beats disposable sources, disposable sources beat free sources, and `blacklist.txt` beats everything. A `manual-free.txt` entry that's also blacklisted is an error.
- **Entries normalized like a query:** every downloaded and hand-written entry goes through the same host normalization as a request (trim, lowercase, punycode). Entries that don't parse as a domain, and bare public suffixes, are dropped.
- **Shrink guard:** if `free.txt` or `disposable.txt` would shrink by more than 10% from the committed version, the run stops before writing anything. Rerun with `npm run update-data -- --allow-shrink` when the drop is expected.
- **Fails loudly:** if any source returns a non-2xx status, the run stops and nothing is written. Fix the URL or remove it from `sources.json`, then run it again.

### Adding or removing a domain by hand

- **Add a free provider:** add the domain to `data/manual-free.txt` with a dated comment saying why (no source lists it, or a disposable source would otherwise catch it). Manual-free entries always end up in `free.txt`, never in `disposable.txt`.
- **Stop a domain being listed:** add it to `data/blacklist.txt`. This is the only way to keep a domain out of both lists, since the refresh would otherwise re-add it from its source.
- **Add or remove a source:** edit `data/sources.json`. A source can be a JSON array of domains or plain text with one domain per line (`#` comments allowed).

After any manual edit, run `npm run update-data` and `npm test`. The tests require every list to be sorted, deduplicated and canonical, with `free.txt` and `disposable.txt` sharing no domains.

### Sources

These are the sources in `data/sources.json`. Their licences and copyright notices are in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

- **Free:** [Kikobeats/free-email-domains](https://github.com/Kikobeats/free-email-domains) (MIT, HubSpot-derived, ~14.3k domains; mixes in some disposable domains, which the disposable rule removes), [ankaboot-source/email-open-data](https://github.com/ankaboot-source/email-open-data)'s `free-email-domains.txt`, `public-email-providers.txt` and `ISP-domains.txt` (CC0, refreshed hourly).
- **Disposable:** [castle/disposable-email-domains](https://github.com/castle/disposable-email-domains) (MIT, ~1,000 domains, high confidence), [disposable-email-domains/disposable-email-domains](https://github.com/disposable-email-domains/disposable-email-domains) (CC0, community-maintained, ~9.2k), [disposable/disposable-email-domains](https://github.com/disposable/disposable-email-domains)'s `domains.txt` in normal mode (MIT, daily aggregate, ~78k).

## Credits

The idea comes from [willwhite/freemail](https://github.com/willwhite/freemail) (ISC), which isn't maintained anymore. Doorman shares none of its code; the first blacklist entries and some hand-added country domains come from its lists (see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)).

## Licence

[MIT](LICENSE). The domain lists in `data/` come from the sources above under their own licences; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
