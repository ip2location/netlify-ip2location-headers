# netlify-ip2location-headers

A Netlify Edge Function that adds **IP2Location.io** data to the origin request as headers. The headers available is depends on the plan subscribed. Sign up for a free plan at [https://www.ip2location.io](https://www.ip2location.io/?utm_source=netlify).



## Headers

| Header | Plan |
| --- | --- |
| `X-IP2Location-ASN` | Keyless |
| `X-IP2Location-AS-Name` | Keyless |
| `X-IP2Location-Is-Proxy` | Keyless |
| `X-IP2Location-ISP`, `-Domain`, `-Net-Speed`, `-Usage-Type` | Starter |
| `X-IP2Location-IDD-Code`, `-Area-Code`, `-Elevation` | Starter |
| `X-IP2Location-Country-Alpha3`, `-Country-Currency`, `-Country-Currency-Symbol`, `-Country-Language`, `-Country-Demonym`, `-Country-Capital`, `-Country-TLD` | Plus |
| `X-IP2Location-Continent`, `-Continent-Name` | Plus |
| `X-IP2Location-Time-Offset`, `-Time-Abbr`, `-Time-DST` | Plus |
| `X-IP2Location-Address-Type` | Plus |
| `X-IP2Location-Mobile-MCC`, `-MNC`, `-Brand` | Plus |
| `X-IP2Location-Metro-Code` | Plus |
| `X-IP2Location-District` | Security |
| `X-IP2Location-AS-Domain`, `-AS-Usage-Type`, `-AS-CIDR` | Security |
| `X-IP2Location-Ads-Category` | Security |
| `X-IP2Location-Fraud-Score` | Security |
| `X-IP2Location-Proxy-Type`, `-Proxy-Provider`, `-Threat`, `-Proxy-Last-Seen`, `-Proxy-Flags` | Security |
| `X-IP2Location-Is-VPN`, `-Is-Tor`, `-Is-Data-Center`, `-Is-Crawler`, `-Is-AI-Crawler` | Security |
| `X-IP2Location-Is-Public-Proxy`, `-Is-Web-Proxy`, `-Is-Residential-Proxy`, `-Is-Privacy-Network`, `-Is-Enterprise-Network` | Security |
| `X-IP2Location-Is-Spammer`, `-Is-Scanner`, `-Is-Botnet`, `-Is-Bogon` | Security |

All 52 headers above are requested on every lookup. The plan decides only whether the API returns a value, so a Keyless site receives the first three and a Security site receives all of them.



Headers for diagnose:

| Header | Values |
| --- | --- |
| `X-IP2Location-Lookup` | `hit` `miss` `error` `invalid` `off` |
| `X-IP2Location-Error` | Only on failure |

A missing header means the plan does not include that field, the value was absent, or the API returned `-`. `Lookup` reports `hit`, `miss` or `off` when the lookup succeeded, so treat `error` and `invalid` as "no data". `off` is the normal reading when caching is disabled with `CACHE_TTL=0`.



## Configuration

Set these in the Netlify UI under Site configuration, Environment variables, with the **Functions** scope. 

| Variable | Default | Meaning |
| --- | --- | --- |
| `IP2LOCATION_API_KEY` | none | API key. Absent uses the keyless lane |
| `CACHE_TTL` | `3600` | Seconds a lookup stays cached. `0` = one API call per request |
| `CACHE_MAX` | `5000` | Cap on cached networks per isolate |
| `ALLOW_QUERY_IP` | `0` | Allow `?ip=` on the debug endpoint |
| `ALLOWED_ORIGINS` | `*` | CORS origin for the debug endpoint |



## Deploy

```bash
npm install -g netlify-cli
netlify link
netlify deploy --prod
```

Set `IP2LOCATION_API_KEY` in the Netlify UI with the Functions scope before the first production request.

Every `.ts` file in `netlify/edge-functions/` is registered as its own edge function, which is why the implementation lives in `lib/` and is imported relatively. Adding a second file to that directory creates a second function.

Relative imports must keep their `.ts` extension (`from '../../lib/fields.ts'`). Netlify bundles the function with Deno, which resolves imports by real path, so an extensionless import fails the build with `Could not find file: .../lib/fields`. `tsc` accepts it either way, so `bun test` covers this instead.



## Local Development

```bash
cp .env.example .env          # Insert your API key
bun test
bun x tsc --noEmit
bun run live
netlify dev                   # runs the edge function on localhost:8888
```

`netlify dev` uses your real location by default. To simulate a visitor, use the documented mock flags:

```bash
netlify dev --geo=mock --country=US
curl "http://localhost:8888/__ip2location?ip=8.8.8.8"
```



## Access the Headers in Web Applications

#### PHP

```php
$isp     = $_SERVER['HTTP_X_IP2LOCATION_ISP'] ?? null;
$flags   = $_SERVER['HTTP_X_IP2LOCATION_PROXY_FLAGS'] ?? '';
$isProxy = $_SERVER['HTTP_X_IP2LOCATION_IS_PROXY'] === 'true';
$isVpn   = str_contains($flags, 'vpn');
```

#### Node.js

```js
const isp     = req.get('x-ip2location-isp');
const flags   = req.get('x-ip2location-proxy-flags') ?? '';
const isProxy = req.get('x-ip2location-is-proxy') === 'true';
const isVpn   = flags.split(',').includes('vpn');
```

#### Python

```python
isp      = request.headers.get('X-IP2Location-ISP')
flags    = request.headers.get('X-IP2Location-Proxy-Flags', '')
is_proxy = request.headers.get('X-IP2Location-Is-Proxy') == 'true'
is_vpn   = 'vpn' in flags.split(',')
```



## Debug Endpoint

`GET /__ip2location` returns the lookup result, the headers that would be sent, the raw payload, and `netlifyGeo` for comparison with what Netlify itself resolved. `?ip=` only works when `ALLOW_QUERY_IP=1`, so the endpoint cannot be used to burn quota.
